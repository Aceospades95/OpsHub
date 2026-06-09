import { NextResponse } from "next/server";

import { uploadFile, StorageQuotaExceededError } from "@/lib/storage";
import { asUploadedFile } from "@/lib/uploaded-file";
import { sniffUploadType } from "@/lib/upload-validation";
import { getPortalSubject, loadPortalStep } from "@/lib/workflows/portal";
import { consume, clientIpFromRequest } from "@/lib/rate-limit";

// File upload happens via FormData/multipart, which server actions don't
// natively support cleanly — so it lives as a route handler. After the
// bytes land we hand the new file id back to the caller, who then calls
// `finalizeWorkflowPortalDocument` to mark the workflow step complete.
//
// Two-step upload-then-finalize keeps the auth surface tight: bytes are
// validated and stored here under the token's authority; the workflow
// state transition is a separate, idempotent call.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME_PREFIXES = [
  "image/",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.",
  "application/vnd.ms-",
  "text/",
];

// Rate limits picked to be looser than legitimate user behavior but
// tight enough to bound storage cost from a leaked token. Capacity
// covers the burst when a user re-uploads after a transient network
// blip; refill is the sustained rate.
//
// IP-side limit catches a single attacker scanning many tokens; token-
// side limit caps damage from a single leaked token.
const IP_RATE = { capacity: 20, refillRatePerSec: 0.5 }; // ~30/min sustained
const TOKEN_RATE = { capacity: 5, refillRatePerSec: 1 / 30 }; // 1 per 30s sustained

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  // IP gate first — token resolution does a DB read so we don't want
  // a brute-force scanner to incur that cost.
  const ip = clientIpFromRequest(req);
  const ipGate = consume(`portal-upload:ip:${ip}`, IP_RATE);
  if (!ipGate.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(ipGate.retryAfterMs / 1000)),
        },
      }
    );
  }

  const subject = await getPortalSubject(token);
  if (!subject) {
    return NextResponse.json({ error: "Invalid token" }, { status: 404 });
  }

  // Per-token gate. Caps storage cost from a leaked token even when
  // the attacker rotates IPs.
  const tokenGate = consume(`portal-upload:token:${token}`, TOKEN_RATE);
  if (!tokenGate.allowed) {
    return NextResponse.json(
      { error: "Upload rate limit reached. Please wait before retrying." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(tokenGate.retryAfterMs / 1000)),
        },
      }
    );
  }

  // Every upload must target a specific open REQUEST_DOCUMENT step on
  // the token's own instance. Free-floating uploads (no step id) would
  // be stored unconditionally — unbounded storage with no workflow to
  // ever claim them.
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Multipart body required" }, { status: 400 });
  }

  const file = asUploadedFile(formData.get("file"));
  const instanceStepId = formData.get("instanceStepId");
  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (typeof instanceStepId !== "string" || instanceStepId.length === 0) {
    return NextResponse.json(
      { error: "instanceStepId is required" },
      { status: 400 }
    );
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: `File exceeds the 10 MB upload limit` },
      { status: 413 }
    );
  }
  if (!ALLOWED_MIME_PREFIXES.some((p) => file.type.startsWith(p))) {
    return NextResponse.json(
      { error: `Unsupported file type: ${file.type || "(unknown)"}` },
      { status: 415 }
    );
  }

  // loadPortalStep rejects steps that don't belong to the token's
  // subject, steps already COMPLETED/SKIPPED, and sealed instances.
  const resolved = await loadPortalStep(token, instanceStepId);
  if (!resolved) {
    return NextResponse.json(
      { error: "Step is not an open step for this portal token" },
      { status: 400 }
    );
  }
  if (resolved.step.workflowStep.stepType !== "REQUEST_DOCUMENT") {
    return NextResponse.json(
      { error: "Step is not a document request" },
      { status: 400 }
    );
  }
  const resolvedStepId = resolved.step.id;

  // Read the file bytes once and hand to the storage layer.
  const buffer = Buffer.from(await file.arrayBuffer());

  // R11-H: server-side magic-byte sniff on top of the prefix-list
  // gate above. The portal accepts external uploads from anonymous
  // subjects via a token, so trusting `file.type` alone would let a
  // renamed binary slip through the prefix check (e.g. .exe labelled
  // application/pdf). SVG is blocked: portal docs are sometimes
  // shown back to the workflow operator and a stored <script> would
  // execute in the operator's session.
  const sniff = sniffUploadType(buffer, file.type || "", { blockSvg: true });
  if (!sniff.ok) {
    return NextResponse.json({ error: sniff.reason }, { status: 415 });
  }

  let stored;
  try {
    stored = await uploadFile({
      content: buffer,
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      uploadedById: subject.subjectType === "EMPLOYEE" ? subject.subjectId : "system",
      visibility: "private",
      // Tag with the subject user id when EMPLOYEE so the file shows up
      // on the employee profile's Files tab as well.
      userId: subject.subjectType === "EMPLOYEE" ? subject.subjectId : undefined,
      // CUSTOM subjects have no User row to own the file, so stamp the
      // step id into the category tag — finalizeWorkflowPortalDocument
      // verifies it to reject forged fileIds. (CUSTOM files never show
      // on an employee Files tab, so the tag is invisible to the UI.)
      category:
        subject.subjectType === "EMPLOYEE"
          ? "workflow"
          : `workflow:${resolvedStepId}`,
    });
  } catch (err) {
    if (err instanceof StorageQuotaExceededError) {
      return NextResponse.json(
        { error: "Storage quota reached for this account. Contact support." },
        { status: 413 }
      );
    }
    throw err;
  }

  return NextResponse.json({
    success: true,
    fileId: stored.id,
    instanceStepId: resolvedStepId,
  });
}
