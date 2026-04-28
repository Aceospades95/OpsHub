/**
 * Workflow analytics + stuck-step detection.
 *
 * Pure-ish queries that drive the /workflows/analytics dashboard and
 * the daily reminder-digest job. Keeping them in one module so the
 * dashboard and the digest agree on the same definitions of "stuck"
 * and "completion time".
 */

import { db } from "@/lib/db";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A step is "stuck" when it's been IN_PROGRESS or PENDING/SCHEDULED
 * past its due time for longer than the threshold.
 *
 * For SCHEDULED steps, the threshold is measured from `scheduledFor` —
 * the engine should have picked it up by now and hasn't.
 *
 * For IN_PROGRESS steps (typically APPROVAL or portal-driven types
 * waiting on the subject), the threshold is measured from `startedAt`.
 */
export const STUCK_THRESHOLD_DAYS = 3;

export interface StuckStep {
  instanceId: string;
  instanceStepId: string;
  instanceCreatedAt: Date;
  templateName: string;
  subjectType: string;
  subjectId: string;
  subjectName: string;
  stepName: string;
  stepType: string;
  status: string;
  /** When the step has been waiting since — scheduledFor for SCHEDULED,
   *  startedAt for IN_PROGRESS. Null if neither is set. */
  waitingSince: Date | null;
  /** Whole-day count since waitingSince. */
  daysWaiting: number;
}

/**
 * Find every step that's been waiting longer than thresholdDays. The
 * dashboard uses this for the "Needs attention" tile; the digest job
 * emails admins about it.
 *
 * Caps at 200 rows to keep the digest email scannable. If you've got
 * more than 200 stuck steps, the email link to the analytics page
 * tells the reader where to see the full list.
 */
export async function findStuckSteps(
  thresholdDays: number = STUCK_THRESHOLD_DAYS,
  now: Date = new Date()
): Promise<StuckStep[]> {
  const cutoff = new Date(now.getTime() - thresholdDays * ONE_DAY_MS);

  // Two cases unified into one fetch — SCHEDULED past scheduledFor and
  // IN_PROGRESS past startedAt. We over-fetch slightly and filter in
  // code so the SQL stays simple.
  const candidates = await db.workflowInstanceStep.findMany({
    where: {
      workflowInstance: { status: "IN_PROGRESS" },
      OR: [
        { status: "SCHEDULED", scheduledFor: { lt: cutoff } },
        { status: "IN_PROGRESS", startedAt: { lt: cutoff } },
      ],
    },
    include: {
      workflowStep: { select: { name: true, stepType: true } },
      workflowInstance: {
        select: {
          id: true,
          createdAt: true,
          subjectType: true,
          subjectId: true,
          workflowTemplate: { select: { name: true } },
        },
      },
    },
    orderBy: [
      { scheduledFor: "asc" },
      { startedAt: "asc" },
    ],
    take: 200,
  });

  // Resolve display names for EMPLOYEE subjects in one batch.
  const employeeIds = Array.from(
    new Set(
      candidates
        .filter((c) => c.workflowInstance.subjectType === "EMPLOYEE")
        .map((c) => c.workflowInstance.subjectId)
    )
  );
  const employees =
    employeeIds.length > 0
      ? await db.user.findMany({
          where: { id: { in: employeeIds } },
          select: { id: true, name: true },
        })
      : [];
  const nameMap = new Map(employees.map((e) => [e.id, e.name]));

  return candidates.map((s) => {
    const waitingSince =
      s.status === "SCHEDULED"
        ? s.scheduledFor
        : s.status === "IN_PROGRESS"
          ? s.startedAt
          : null;
    const daysWaiting = waitingSince
      ? Math.floor((now.getTime() - waitingSince.getTime()) / ONE_DAY_MS)
      : 0;
    const subjectName =
      s.workflowInstance.subjectType === "EMPLOYEE"
        ? (nameMap.get(s.workflowInstance.subjectId) ?? "(missing employee)")
        : `${s.workflowInstance.subjectType.toLowerCase()} ${s.workflowInstance.subjectId.slice(0, 8)}`;
    return {
      instanceId: s.workflowInstanceId,
      instanceStepId: s.id,
      instanceCreatedAt: s.workflowInstance.createdAt,
      templateName: s.workflowInstance.workflowTemplate.name,
      subjectType: s.workflowInstance.subjectType,
      subjectId: s.workflowInstance.subjectId,
      subjectName,
      stepName: s.workflowStep.name,
      stepType: s.workflowStep.stepType,
      status: s.status,
      waitingSince,
      daysWaiting,
    };
  });
}

// ─── Aggregate analytics ────────────────────────────────────────────────

export interface WorkflowAnalytics {
  /** Number of instances currently active (PENDING + IN_PROGRESS + PAUSED). */
  active: number;
  /** Number of instances that have completed in the last N days. */
  completedRecent: number;
  /** Average completion time in days for instances that completed in the
   *  same window. Null when nothing's completed yet. */
  avgCompletionDays: number | null;
  /** Per-template stats for the analytics dashboard. */
  perTemplate: PerTemplateStats[];
  /** Stuck-step count for the "Needs attention" tile. */
  stuckCount: number;
}

export interface PerTemplateStats {
  templateId: string;
  templateName: string;
  type: string;
  active: number;
  completed: number;
  cancelled: number;
  /** Completion rate, as a percentage 0-100. Excludes still-running
   *  instances; counts COMPLETED / (COMPLETED + CANCELLED). */
  completionRate: number | null;
  /** Average completion days for this template alone. */
  avgCompletionDays: number | null;
}

/**
 * Compute the dashboard's headline stats over the trailing `windowDays`
 * (default 90). One round trip per metric — small enough to be instant
 * for any reasonable workflow volume.
 */
export async function getWorkflowAnalytics(
  windowDays: number = 90,
  now: Date = new Date()
): Promise<WorkflowAnalytics> {
  const since = new Date(now.getTime() - windowDays * ONE_DAY_MS);

  const [active, completedRecent, completedWithDuration, perTemplateRaw] =
    await Promise.all([
      db.workflowInstance.count({
        where: { status: { in: ["PENDING", "IN_PROGRESS", "PAUSED"] } },
      }),
      db.workflowInstance.count({
        where: { status: "COMPLETED", completedAt: { gte: since } },
      }),
      db.workflowInstance.findMany({
        where: { status: "COMPLETED", completedAt: { gte: since } },
        select: { startDate: true, completedAt: true },
      }),
      db.workflowInstance.groupBy({
        by: ["workflowTemplateId", "status"],
        _count: { _all: true },
      }),
    ]);

  // avg completion days from the recent-completed slice.
  const avgCompletionDays =
    completedWithDuration.length > 0
      ? round2(
          completedWithDuration.reduce(
            (acc, i) =>
              acc +
              (i.completedAt && i.startDate
                ? (i.completedAt.getTime() - i.startDate.getTime()) / ONE_DAY_MS
                : 0),
            0
          ) / completedWithDuration.length
        )
      : null;

  // Bucket per-template stats from the groupBy result.
  type Bucket = { active: number; completed: number; cancelled: number };
  const buckets = new Map<string, Bucket>();
  for (const row of perTemplateRaw) {
    const key = row.workflowTemplateId;
    if (!buckets.has(key))
      buckets.set(key, { active: 0, completed: 0, cancelled: 0 });
    const b = buckets.get(key)!;
    if (
      row.status === "PENDING" ||
      row.status === "IN_PROGRESS" ||
      row.status === "PAUSED"
    ) {
      b.active += row._count._all;
    } else if (row.status === "COMPLETED") {
      b.completed += row._count._all;
    } else if (row.status === "CANCELLED") {
      b.cancelled += row._count._all;
    }
  }

  // Resolve template names + types in one query.
  const templateIds = Array.from(buckets.keys());
  const templates =
    templateIds.length > 0
      ? await db.workflowTemplate.findMany({
          where: { id: { in: templateIds } },
          select: { id: true, name: true, type: true },
        })
      : [];

  // Per-template avg completion: one query, grouping client-side.
  const perTemplateCompleted = await db.workflowInstance.findMany({
    where: {
      status: "COMPLETED",
      workflowTemplateId: { in: templateIds },
      completedAt: { gte: since },
    },
    select: { workflowTemplateId: true, startDate: true, completedAt: true },
  });
  const perTemplateAvg = new Map<string, number | null>();
  const perTemplateCounts = new Map<string, { sum: number; count: number }>();
  for (const c of perTemplateCompleted) {
    if (!c.completedAt) continue;
    const days =
      (c.completedAt.getTime() - c.startDate.getTime()) / ONE_DAY_MS;
    const acc = perTemplateCounts.get(c.workflowTemplateId) ?? {
      sum: 0,
      count: 0,
    };
    acc.sum += days;
    acc.count += 1;
    perTemplateCounts.set(c.workflowTemplateId, acc);
  }
  for (const [k, v] of Array.from(perTemplateCounts.entries())) {
    perTemplateAvg.set(k, v.count > 0 ? round2(v.sum / v.count) : null);
  }

  const perTemplate: PerTemplateStats[] = templates.map((t) => {
    const b = buckets.get(t.id) ?? { active: 0, completed: 0, cancelled: 0 };
    const closed = b.completed + b.cancelled;
    return {
      templateId: t.id,
      templateName: t.name,
      type: t.type,
      active: b.active,
      completed: b.completed,
      cancelled: b.cancelled,
      completionRate:
        closed > 0 ? Math.round((b.completed / closed) * 100) : null,
      avgCompletionDays: perTemplateAvg.get(t.id) ?? null,
    };
  });

  // Sort by total volume descending so the busiest templates surface first.
  perTemplate.sort(
    (a, b) =>
      b.active + b.completed + b.cancelled - (a.active + a.completed + a.cancelled)
  );

  const stuckCount = (await findStuckSteps()).length;

  return {
    active,
    completedRecent,
    avgCompletionDays,
    perTemplate,
    stuckCount,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
