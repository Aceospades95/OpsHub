/**
 * Portal-side helpers — token → subject resolution and the read-side
 * shape of the portal's task checklist.
 *
 * The portal is the public face that subjects (new hires, departing
 * employees, candidates) interact with to complete the steps a
 * workflow asks of them. It never requires an OpsHub account; the
 * cryptographic PortalToken is the auth boundary. Every public action
 * goes through these helpers so the token is validated in one place.
 */

import { db } from "@/lib/db";
import type {
  WorkflowInstance,
  WorkflowInstanceStep,
  WorkflowStep,
  WorkflowStepType,
  WorkflowSubjectType,
} from "@prisma/client";

export interface PortalSubjectResolution {
  subjectType: WorkflowSubjectType;
  subjectId: string;
  /** Display name; "(unknown)" when the subject row has been deleted. */
  displayName: string;
  /** The PortalToken row id — useful for stamping `lastUsedAt`. */
  tokenId: string;
}

/**
 * Resolve a portal token to a subject. Returns null when the token
 * doesn't exist, has expired, or points at a vanished entity. Updates
 * `lastUsedAt` as a side effect so admins can see which links are
 * actively in use from /admin/jobs or future portal-analytics views.
 */
export async function getPortalSubject(
  token: string
): Promise<PortalSubjectResolution | null> {
  const row = await db.portalToken.findUnique({ where: { token } });
  if (!row) return null;
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;

  let displayName = "(unknown)";
  if (row.subjectType === "EMPLOYEE") {
    const user = await db.user.findUnique({
      where: { id: row.subjectId },
      select: { name: true, isActive: true },
    });
    if (!user || !user.isActive) return null;
    displayName = user.name || "(no name)";
  } else if (row.subjectType === "CANDIDATE") {
    // Candidate model isn't in the schema yet — fall back to a stub
    // identity so the page still renders. Phase 6 will add Candidate
    // and replace this branch.
    displayName = `Candidate ${row.subjectId.slice(0, 8)}`;
  } else {
    displayName = `Subject ${row.subjectId.slice(0, 8)}`;
  }

  // Don't await the lastUsedAt write — the read should not stall on
  // a metadata stamp. Fire-and-forget.
  void db.portalToken
    .update({
      where: { id: row.id },
      data: { lastUsedAt: new Date() },
    })
    .catch(() => {});

  return {
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    displayName,
    tokenId: row.id,
  };
}

// ─── Checklist read shape ──────────────────────────────────────────────

/** Step types the portal renders interactive UI for. Other step types
 *  (send_email, wait, etc.) execute fully on the server and don't
 *  surface on the subject's checklist. */
export const PORTAL_STEP_TYPES: WorkflowStepType[] = [
  "REQUEST_DOCUMENT",
  "REQUEST_SIGNATURE",
  "REQUEST_FORM",
  "ASSIGN_TASK_TO_SUBJECT",
];

export interface PortalChecklistItem {
  /** WorkflowInstanceStep id — what completePortalStep() takes. */
  instanceStepId: string;
  /** Parent instance id — handy for client-side state. */
  instanceId: string;
  /** Step type the portal needs to render UI for. */
  stepType: WorkflowStepType;
  /** Human-readable step label. */
  stepName: string;
  /** Step config blob (already parsed) — supplies the UI's
   *  field/document/signature payload. */
  config: Record<string, unknown>;
  /** Workflow template name for context grouping. */
  workflowName: string;
  /** When this item was scheduled — used for sort order, oldest first. */
  scheduledFor: Date | null;
  /** Whether the step is required (drives the visual "must do" tag). */
  isRequired: boolean;
}

export interface PortalCompletedItem {
  instanceStepId: string;
  workflowName: string;
  stepName: string;
  stepType: WorkflowStepType;
  completedAt: Date;
}

export interface PortalView {
  subject: PortalSubjectResolution;
  pending: PortalChecklistItem[];
  completed: PortalCompletedItem[];
  /** Total non-skipped steps across all active instances — drives the
   *  progress bar at the top of the portal. */
  total: number;
}

/**
 * Build the portal's at-a-glance view. Reads every IN_PROGRESS workflow
 * instance for the subject + every step on each instance, partitioning
 * them into pending (open + portal-actionable) and completed.
 */
export async function buildPortalView(
  subject: PortalSubjectResolution
): Promise<PortalView> {
  const instances = await db.workflowInstance.findMany({
    where: {
      subjectType: subject.subjectType,
      subjectId: subject.subjectId,
      status: { in: ["IN_PROGRESS", "PAUSED", "COMPLETED"] },
    },
    include: {
      workflowTemplate: { select: { name: true } },
      steps: {
        include: { workflowStep: true },
        orderBy: { workflowStep: { position: "asc" } },
      },
    },
    orderBy: { startDate: "desc" },
  });

  const pending: PortalChecklistItem[] = [];
  const completed: PortalCompletedItem[] = [];
  let total = 0;

  for (const instance of instances) {
    for (const s of instance.steps) {
      // Skip "skipped" steps in totals — they didn't run, they're not
      // achievements. Failed steps stay visible so the subject sees
      // what went wrong if anything.
      if (s.status === "SKIPPED") continue;
      total++;

      const isPortalType = PORTAL_STEP_TYPES.includes(s.workflowStep.stepType);
      if (!isPortalType) continue;

      if (s.status === "COMPLETED") {
        completed.push({
          instanceStepId: s.id,
          workflowName: instance.workflowTemplate.name,
          stepName: s.workflowStep.name,
          stepType: s.workflowStep.stepType,
          completedAt: s.completedAt ?? new Date(),
        });
        continue;
      }

      // Pending: anything else portal-actionable (PENDING, SCHEDULED,
      // IN_PROGRESS, FAILED). Failed steps appear with an error tag;
      // the subject can re-submit which will completeStep again.
      if (
        s.status === "PENDING" ||
        s.status === "SCHEDULED" ||
        s.status === "IN_PROGRESS" ||
        s.status === "FAILED"
      ) {
        let parsedConfig: Record<string, unknown> = {};
        try {
          parsedConfig = JSON.parse(s.workflowStep.config);
        } catch {
          parsedConfig = {};
        }
        pending.push({
          instanceStepId: s.id,
          instanceId: instance.id,
          stepType: s.workflowStep.stepType,
          stepName: s.workflowStep.name,
          config: parsedConfig,
          workflowName: instance.workflowTemplate.name,
          scheduledFor: s.scheduledFor,
          isRequired: s.workflowStep.isRequired,
        });
      }
    }
  }

  // Stable sort by scheduledFor ascending (oldest waiting at the top
  // so the subject works through them in the order they were issued).
  pending.sort((a, b) => {
    const at = a.scheduledFor?.getTime() ?? 0;
    const bt = b.scheduledFor?.getTime() ?? 0;
    return at - bt;
  });
  completed.sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime());

  return { subject, pending, completed, total };
}

// ─── Write-side helpers ────────────────────────────────────────────────

/** Verify a token + step belong together. Returns the step row when
 *  ok; null when the token isn't valid or doesn't own the step.
 *  Used by every portal write action so the token is the only thing
 *  that authorizes a mutation. */
export async function loadPortalStep(
  token: string,
  instanceStepId: string
): Promise<{
  subject: PortalSubjectResolution;
  step: WorkflowInstanceStep & {
    workflowStep: WorkflowStep;
    workflowInstance: WorkflowInstance;
  };
} | null> {
  const subject = await getPortalSubject(token);
  if (!subject) return null;

  const step = await db.workflowInstanceStep.findUnique({
    where: { id: instanceStepId },
    include: { workflowStep: true, workflowInstance: true },
  });
  if (!step) return null;
  if (
    step.workflowInstance.subjectType !== subject.subjectType ||
    step.workflowInstance.subjectId !== subject.subjectId
  ) {
    return null;
  }
  return { subject, step };
}
