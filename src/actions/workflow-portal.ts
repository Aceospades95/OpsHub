"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";

import { completeStep } from "@/lib/workflows/engine";
import { revalidateWorkflowInstance } from "@/lib/revalidate-entity";
import { loadPortalStep } from "@/lib/workflows/portal";
import { consume } from "@/lib/rate-limit";

/**
 * Per-token rate cap on portal write actions. Capacity allows a small
 * burst (the user may submit a form, then immediately upload a
 * follow-up document) while the refill rate keeps the long-run
 * behavior sane. A leaked token is still useful for finishing
 * legitimate paperwork but can't be weaponized to spam writes.
 */
const PORTAL_ACTION_RATE = {
  capacity: 10,
  refillRatePerSec: 1 / 6, // ~10/min sustained
};

function checkPortalActionRate(token: string):
  | { error: string; retryAfterSec: number }
  | null {
  const gate = consume(`portal-action:${token}`, PORTAL_ACTION_RATE);
  if (gate.allowed) return null;
  return {
    error: "Too many submissions in a short time. Please wait and retry.",
    retryAfterSec: Math.ceil(gate.retryAfterMs / 1000),
  };
}

/**
 * Resolve the calling client's IP from request headers in a server-action
 * context. Mirrors clientIpFromRequest() from lib/rate-limit (and
 * loginClientIp in actions/auth.ts). Never trust a client-supplied ip
 * value — the signature audit trail records this server-derived one.
 */
function portalClientIp(): string {
  const trustProxy =
    (process.env.RATE_LIMIT_TRUST_PROXY ?? "true").toLowerCase() !== "false";
  if (trustProxy) {
    const h = headers();
    const xff = h.get("x-forwarded-for");
    if (xff) {
      const first = xff.split(",")[0]?.trim();
      if (first) return first;
    }
    const real = h.get("x-real-ip");
    if (real) return real.trim();
  }
  return "remote";
}

// ─── Schemas ───────────────────────────────────────────────────────────

const submitSignatureSchema = z.object({
  token: z.string().min(1),
  instanceStepId: z.string().min(1),
  signedName: z.string().min(1, "Type your name to sign").max(200),
  // Data-URL of the drawn signature. 200k bounds the stored blob — a
  // reasonable canvas PNG is well under that.
  signatureData: z.string().max(200_000).nullish(),
});

/** Per-value size ceiling on form responses — they're attacker-
 *  controlled and stored verbatim in the step output. */
const MAX_FORM_RESPONSE_LENGTH = 10_000;

const submitFormSchema = z.object({
  token: z.string().min(1),
  instanceStepId: z.string().min(1),
  /** Form responses keyed by field key. Validation against the field
   *  schema (required/type) happens here — not at the engine level —
   *  because only the portal knows the user's perspective. Keys are
   *  filtered to the step's configured fields below. */
  responses: z.record(z.unknown()),
});

const completeTaskSchema = z.object({
  token: z.string().min(1),
  instanceStepId: z.string().min(1),
});

// ─── Document upload finalize ──────────────────────────────────────────
//
// The actual file bytes get written by the route handler at
// /api/public/portal/[token]/upload (FormData/multipart needs a route,
// not a server action). After that route creates the File row + the
// WorkflowDocument row, IT calls completeWorkflowPortalStep here to
// flip the step status to COMPLETED. Splitting the two lets the route
// stay focused on byte handling and the action handle workflow state.

const finalizeDocumentSchema = z.object({
  token: z.string().min(1),
  instanceStepId: z.string().min(1),
  fileId: z.string().min(1),
});

export async function finalizeWorkflowPortalDocument(
  input: z.infer<typeof finalizeDocumentSchema>
) {
  const parsed = finalizeDocumentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: "Invalid input",
      fieldErrors: parsed.error.flatten().fieldErrors,
    } as const;
  }
  const limited = checkPortalActionRate(parsed.data.token);
  if (limited) return limited;
  const resolved = await loadPortalStep(parsed.data.token, parsed.data.instanceStepId);
  if (!resolved) {
    return { error: "Token or step not found" } as const;
  }
  if (resolved.step.workflowStep.stepType !== "REQUEST_DOCUMENT") {
    return { error: "Step is not a document request" } as const;
  }

  // Verify the File belongs to the same subject — defensive against a
  // forged fileId. The upload route already enforces subject ownership
  // when it writes the row, but we re-check here.
  const file = await db.file.findUnique({
    where: { id: parsed.data.fileId },
    select: { id: true, userId: true, uploadedById: true, category: true },
  });
  if (!file) return { error: "File not found" } as const;
  if (resolved.subject.subjectType === "EMPLOYEE") {
    if (file.userId !== resolved.subject.subjectId) {
      return { error: "File does not belong to this subject" } as const;
    }
  } else {
    // CUSTOM subjects have no User row to own the file. The upload
    // route stamps their rows uploadedById="system" + the step id in
    // the category tag — require an exact stamp for THIS step so a
    // forged fileId can't attach another user's (or another
    // instance's) file.
    if (
      file.uploadedById !== "system" ||
      file.category !== `workflow:${resolved.step.id}`
    ) {
      return { error: "File does not belong to this subject" } as const;
    }
  }

  await db.workflowDocument.create({
    data: {
      workflowInstanceStepId: resolved.step.id,
      fileId: parsed.data.fileId,
    },
  });

  await db.workflowEvent.create({
    data: {
      workflowInstanceId: resolved.step.workflowInstanceId,
      eventType: "document_uploaded",
      actorType: "subject",
      metadata: JSON.stringify({
        stepName: resolved.step.workflowStep.name,
        fileId: parsed.data.fileId,
      }),
    },
  });

  await completeStep(resolved.step.id, {
    fileId: parsed.data.fileId,
    actor: "subject",
  });

  revalidatePath(`/portal/${parsed.data.token}`);
  revalidateWorkflowInstance(resolved.step.workflowInstanceId);
  return { success: true } as const;
}

// ─── Signature ─────────────────────────────────────────────────────────

export async function submitWorkflowPortalSignature(
  input: z.infer<typeof submitSignatureSchema>
) {
  const parsed = submitSignatureSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: "Invalid input",
      fieldErrors: parsed.error.flatten().fieldErrors,
    } as const;
  }
  const limited = checkPortalActionRate(parsed.data.token);
  if (limited) return limited;
  const resolved = await loadPortalStep(parsed.data.token, parsed.data.instanceStepId);
  if (!resolved) {
    return { error: "Token or step not found" } as const;
  }
  if (resolved.step.workflowStep.stepType !== "REQUEST_SIGNATURE") {
    return { error: "Step is not a signature request" } as const;
  }

  // Snapshot the document text from the step config so a later edit
  // to the template's documentText doesn't change what was signed.
  let documentTextSnapshot: string | null = null;
  try {
    const cfg = JSON.parse(resolved.step.workflowStep.config) as {
      documentText?: string;
    };
    documentTextSnapshot = cfg.documentText ?? null;
  } catch {
    documentTextSnapshot = null;
  }

  // The signed IP is part of the audit trail — derive it server-side
  // from request headers; a client-supplied value would be forgeable.
  const ip = portalClientIp();

  await db.workflowSignature.create({
    data: {
      workflowInstanceStepId: resolved.step.id,
      signedName: parsed.data.signedName,
      signatureData: parsed.data.signatureData ?? null,
      signedIp: ip,
      documentTextSnapshot,
    },
  });

  await db.workflowEvent.create({
    data: {
      workflowInstanceId: resolved.step.workflowInstanceId,
      eventType: "document_signed",
      actorType: "subject",
      metadata: JSON.stringify({
        stepName: resolved.step.workflowStep.name,
        signedName: parsed.data.signedName,
        ip,
      }),
    },
  });

  await completeStep(resolved.step.id, {
    signedName: parsed.data.signedName,
    actor: "subject",
  });

  revalidatePath(`/portal/${parsed.data.token}`);
  revalidateWorkflowInstance(resolved.step.workflowInstanceId);
  return { success: true } as const;
}

// ─── Form submission ───────────────────────────────────────────────────

export async function submitWorkflowPortalForm(
  input: z.infer<typeof submitFormSchema>
) {
  const parsed = submitFormSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: "Invalid input",
      fieldErrors: parsed.error.flatten().fieldErrors,
    } as const;
  }
  const limited = checkPortalActionRate(parsed.data.token);
  if (limited) return limited;
  const resolved = await loadPortalStep(parsed.data.token, parsed.data.instanceStepId);
  if (!resolved) {
    return { error: "Token or step not found" } as const;
  }
  if (resolved.step.workflowStep.stepType !== "REQUEST_FORM") {
    return { error: "Step is not a form request" } as const;
  }

  // Validate against the form schema — required fields must be present
  // and non-empty. We don't enforce per-type validation strictly (a
  // number field accepts strings) since the form-builder is intentionally
  // permissive; the server stores whatever the subject submits.
  let fields: Array<{ key: string; required?: boolean; label?: string }> = [];
  try {
    const cfg = JSON.parse(resolved.step.workflowStep.config) as {
      fields?: Array<{ key: string; required?: boolean; label?: string }>;
    };
    fields = cfg.fields ?? [];
  } catch {
    fields = [];
  }
  // Keep only configured field keys and bound each value's size — the
  // responses blob is attacker-controlled and stored verbatim, so an
  // unfiltered record could smuggle arbitrary keys or megabytes of
  // padding into the step output.
  const allowedKeys = new Set(fields.map((f) => f.key));
  const responses: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed.data.responses)) {
    if (!allowedKeys.has(key)) continue;
    const size =
      typeof value === "string"
        ? value.length
        : (JSON.stringify(value) ?? "").length;
    if (size > MAX_FORM_RESPONSE_LENGTH) {
      return { error: `Response too long for field: ${key}` } as const;
    }
    responses[key] = value;
  }

  for (const f of fields) {
    if (!f.required) continue;
    const v = responses[f.key];
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) {
      return {
        error: `Required field missing: ${f.label ?? f.key}`,
      } as const;
    }
  }

  await db.workflowEvent.create({
    data: {
      workflowInstanceId: resolved.step.workflowInstanceId,
      eventType: "form_submitted",
      actorType: "subject",
      metadata: JSON.stringify({
        stepName: resolved.step.workflowStep.name,
      }),
    },
  });

  await completeStep(resolved.step.id, {
    responses,
    actor: "subject",
  });

  revalidatePath(`/portal/${parsed.data.token}`);
  revalidateWorkflowInstance(resolved.step.workflowInstanceId);
  return { success: true } as const;
}

// ─── Subject task completion (ASSIGN_TASK_TO_SUBJECT) ──────────────────

export async function completeWorkflowPortalTaskStep(
  input: z.infer<typeof completeTaskSchema>
) {
  const parsed = completeTaskSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: "Invalid input",
      fieldErrors: parsed.error.flatten().fieldErrors,
    } as const;
  }
  const limited = checkPortalActionRate(parsed.data.token);
  if (limited) return limited;
  const resolved = await loadPortalStep(parsed.data.token, parsed.data.instanceStepId);
  if (!resolved) {
    return { error: "Token or step not found" } as const;
  }
  if (resolved.step.workflowStep.stepType !== "ASSIGN_TASK_TO_SUBJECT") {
    return { error: "Step is not a subject task" } as const;
  }

  // Mark the linked Task done as well so the existing /tasks UI
  // reflects what the portal just did.
  await db.task.updateMany({
    where: {
      sourceType: "workflow_step",
      sourceId: resolved.step.id,
    },
    data: { status: "DONE", completedAt: new Date() },
  });

  await db.workflowEvent.create({
    data: {
      workflowInstanceId: resolved.step.workflowInstanceId,
      eventType: "task_completed_by_subject",
      actorType: "subject",
      metadata: JSON.stringify({
        stepName: resolved.step.workflowStep.name,
      }),
    },
  });

  await completeStep(resolved.step.id, { actor: "subject" });

  revalidatePath(`/portal/${parsed.data.token}`);
  revalidateWorkflowInstance(resolved.step.workflowInstanceId);
  return { success: true } as const;
}
