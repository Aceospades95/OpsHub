/**
 * Workflow auto-triggers.
 *
 * Triggers are stored on WorkflowTrigger rows attached to a template.
 * When something interesting happens in the system (a User is created,
 * a date approaches, a stage flips), the relevant `fire*` helper here
 * looks up active triggers and spawns workflow instances.
 *
 * Trigger types:
 *
 *   ENTITY_CREATE  — fired by the action that creates the entity, right
 *                    after the row commits. config.entityType selects
 *                    which entity ("User" today; "Candidate" Phase 5+).
 *
 *   SCHEDULED_DATE — evaluated by the cron tick worker. config.dateField
 *                    + offsetDays decide when to fire.
 *
 *   STAGE_CHANGE   — Phase 5+. Fires when a Candidate's stage flips to
 *                    a target value.
 *
 * Failure handling: triggers must NEVER throw out of the originating
 * action. If onboarding-template-spawn fails for some reason, we
 * silently log the error so the actual createUser still succeeds —
 * losing a workflow instance is recoverable; losing a user create
 * because of a flaky workflow is not.
 */

import { db } from "@/lib/db";
import { createInstance } from "./engine";
import type { WorkflowSubjectType } from "@prisma/client";

export interface EntityCreateEvent {
  /** Entity type that was just created. Compared case-insensitively
   *  against the trigger config. */
  entityType: "User" | "Candidate";
  /** Id of the entity row. Becomes the workflow instance's subjectId. */
  entityId: string;
  /** User performing the create — attribution for the spawned instance. */
  createdById: string;
  /** Optional target date — required when the matched template's
   *  workflow type is OFFBOARDING (which uses DAYS_BEFORE_TARGET). For
   *  ENTITY_CREATE+OFFBOARDING the trigger is unusual but supported. */
  targetDate?: Date | null;
}

/**
 * Fire all matching ENTITY_CREATE triggers for the given event. Returns
 * the spawned instance ids. Catches per-trigger errors so one bad
 * template doesn't block sibling triggers.
 */
export async function fireEntityCreateTriggers(
  event: EntityCreateEvent
): Promise<{ instanceIds: string[]; errors: string[] }> {
  // Map subject type from the entity type — User → EMPLOYEE,
  // Candidate → CANDIDATE. Any other entity stays out of scope, and
  // we short-circuit BEFORE the DB query so unrelated creates don't
  // pay the round trip.
  const subjectType: WorkflowSubjectType | null =
    event.entityType === "User"
      ? "EMPLOYEE"
      : event.entityType === "Candidate"
        ? "CANDIDATE"
        : null;
  if (!subjectType) {
    return { instanceIds: [], errors: [] };
  }

  const triggers = await db.workflowTrigger.findMany({
    where: {
      triggerType: "ENTITY_CREATE",
      isActive: true,
      workflowTemplate: { isActive: true },
    },
    include: { workflowTemplate: true },
  });

  const instanceIds: string[] = [];
  const errors: string[] = [];
  for (const t of triggers) {
    let cfg: { entityType?: string } = {};
    try {
      cfg = JSON.parse(t.config) as { entityType?: string };
    } catch {
      // Bad config — skip silently, surface as error.
      errors.push(`Trigger ${t.id}: invalid config JSON`);
      continue;
    }
    if (
      typeof cfg.entityType !== "string" ||
      cfg.entityType.toLowerCase() !== event.entityType.toLowerCase()
    ) {
      continue;
    }

    // Skip when the template's subject type doesn't match the entity —
    // e.g. an ENTITY_CREATE trigger for User shouldn't kick a CANDIDATE
    // template even if someone misconfigured them.
    if (t.workflowTemplate.subjectEntityType !== subjectType) {
      continue;
    }

    try {
      const r = await createInstance({
        templateId: t.workflowTemplateId,
        subjectType,
        subjectId: event.entityId,
        createdById: event.createdById,
        targetDate: event.targetDate ?? null,
        autoStart: true,
      });
      instanceIds.push(r.instanceId);
    } catch (err) {
      errors.push(
        `Trigger ${t.id} (${t.workflowTemplate.name}): ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return { instanceIds, errors };
}

/**
 * Fire scheduled-date triggers — called by the workflows-tick cron job.
 *
 * For each active SCHEDULED_DATE trigger:
 *   1. Read its config: { dateField, offsetDays }
 *   2. Resolve `dateField` against the matching subject entity. The
 *      only supported field today is User.terminationDate (added in
 *      Phase 6); future date fields plug in here.
 *   3. Find subjects whose dateField falls within today's one-day
 *      window centered on `now + offsetDays`. The window is a day
 *      wide so a single missed cron tick doesn't drop a fire.
 *   4. Skip subjects that already have a non-cancelled instance of
 *      this template — daily ticks must be idempotent.
 */
export async function fireScheduledDateTriggers(now: Date = new Date()): Promise<{
  instanceIds: string[];
  errors: string[];
}> {
  const triggers = await db.workflowTrigger.findMany({
    where: {
      triggerType: "SCHEDULED_DATE",
      isActive: true,
      workflowTemplate: { isActive: true },
    },
    include: { workflowTemplate: true },
  });
  if (triggers.length === 0) return { instanceIds: [], errors: [] };

  const instanceIds: string[] = [];
  const errors: string[] = [];

  for (const trigger of triggers) {
    let cfg: { dateField?: string; offsetDays?: number } = {};
    try {
      cfg = JSON.parse(trigger.config);
    } catch {
      errors.push(`Trigger ${trigger.id}: invalid config JSON`);
      continue;
    }
    if (!cfg.dateField) {
      errors.push(`Trigger ${trigger.id}: missing dateField`);
      continue;
    }
    const offsetDays = Number.isFinite(cfg.offsetDays) ? cfg.offsetDays! : 0;

    if (
      cfg.dateField !== "terminationDate" ||
      trigger.workflowTemplate.subjectEntityType !== "EMPLOYEE"
    ) {
      // Unknown field — silent skip. Future date fields slot in here.
      continue;
    }

    const eligibleSubjects = await findEligibleEmployeesByTerminationDate(
      now,
      offsetDays,
      trigger.workflowTemplateId
    );
    for (const subject of eligibleSubjects) {
      try {
        const r = await createInstance({
          templateId: trigger.workflowTemplateId,
          subjectType: "EMPLOYEE",
          subjectId: subject.id,
          // Self-attribution: a system trigger fired this. The instance
          // detail UI shows "Started by {creator}" — using the subject
          // themselves keeps the link semantically meaningful.
          createdById: subject.id,
          targetDate: subject.terminationDate,
          autoStart: true,
        });
        instanceIds.push(r.instanceId);
      } catch (err) {
        errors.push(
          `Trigger ${trigger.id} (${trigger.workflowTemplate.name}): ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  return { instanceIds, errors };
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

async function findEligibleEmployeesByTerminationDate(
  now: Date,
  offsetDays: number,
  workflowTemplateId: string
): Promise<{ id: string; terminationDate: Date }[]> {
  // The trigger fires when terminationDate falls in the
  // [today + offsetDays, today + offsetDays + 1day) window.
  // Example: offsetDays = -7 means "fire 7 days BEFORE termination",
  // so we look for terminationDates exactly 7 days ahead of today.
  const targetMid = startOfUtcDay(
    new Date(now.getTime() - offsetDays * ONE_DAY_MS)
  );
  const windowStart = new Date(targetMid.getTime());
  const windowEnd = new Date(targetMid.getTime() + ONE_DAY_MS);

  const candidates = await db.user.findMany({
    where: {
      isActive: true,
      terminationDate: { gte: windowStart, lt: windowEnd },
    },
    select: { id: true, terminationDate: true },
  });

  if (candidates.length === 0) return [];

  // Idempotency check: skip subjects that already have a non-cancelled
  // instance of this template, in any state (PENDING, IN_PROGRESS,
  // PAUSED, COMPLETED). Allowing CANCELLED rows lets an admin retry
  // by cancelling the existing instance.
  const subjectIds = candidates.map((c) => c.id);
  const existing = await db.workflowInstance.findMany({
    where: {
      workflowTemplateId,
      subjectType: "EMPLOYEE",
      subjectId: { in: subjectIds },
      status: { in: ["PENDING", "IN_PROGRESS", "PAUSED", "COMPLETED"] },
    },
    select: { subjectId: true },
  });
  const existingSet = new Set(existing.map((e) => e.subjectId));

  return candidates
    .filter((c) => c.terminationDate != null && !existingSet.has(c.id))
    .map((c) => ({ id: c.id, terminationDate: c.terminationDate! }));
}

function startOfUtcDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
