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
 * Phase 4 supports User.terminationDate as the only date field (we
 * don't have one yet — Phase 6 will add it to the User model). For
 * forward-compatibility this function returns 0 today; the structure
 * is in place so adding date-driven onboarding/offboarding kickoffs
 * is just a matter of wiring the field.
 */
export async function fireScheduledDateTriggers(_now: Date = new Date()): Promise<{
  instanceIds: string[];
  errors: string[];
}> {
  // Stub for Phase 4. Real implementation lives alongside the
  // termination_date field in Phase 6.
  return { instanceIds: [], errors: [] };
}
