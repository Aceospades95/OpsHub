/**
 * Workflow step timing helpers.
 *
 * Each WorkflowStep has a timingType + timingValue that describes WHEN
 * the step should run relative to the instance's startDate / targetDate
 * or to a previous step's completion. This module is the canonical place
 * that resolves those rules into a concrete `scheduledFor` timestamp.
 *
 * The Phase 4 execution engine will call resolveScheduledFor() to seed
 * the WorkflowInstanceStep.scheduledFor column when an instance starts,
 * and again when an "after_step" predecessor completes. Phase 3 only
 * needs the function to exist + be tested so the engine can use it.
 */

import type { WorkflowTimingType } from "@prisma/client";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ResolveSchedulingInput {
  timingType: WorkflowTimingType;
  /** Days offset for DAYS_AFTER_START / DAYS_BEFORE_TARGET. Ignored
   *  for ON_ENTRY and AFTER_STEP. Negative values are accepted (e.g. a
   *  Day -7 onboarding step runs 7 days before startDate). */
  timingValue: number;
  /** Required for any timing rule that references the instance dates. */
  instanceStartDate: Date;
  /** Required for DAYS_BEFORE_TARGET. Returns null if missing. */
  instanceTargetDate?: Date | null;
  /** Required for AFTER_STEP. Returns null if missing. */
  predecessorCompletedAt?: Date | null;
}

/**
 * Compute the scheduled timestamp for a step. Returns null when the
 * required input for the rule is missing — the engine treats that as
 * "not scheduled yet" and re-evaluates later.
 */
export function resolveScheduledFor(input: ResolveSchedulingInput): Date | null {
  switch (input.timingType) {
    case "ON_ENTRY":
      // Runs the moment the instance enters in_progress.
      return input.instanceStartDate;

    case "DAYS_AFTER_START":
      return new Date(
        input.instanceStartDate.getTime() + input.timingValue * MS_PER_DAY
      );

    case "DAYS_BEFORE_TARGET":
      if (!input.instanceTargetDate) return null;
      return new Date(
        input.instanceTargetDate.getTime() - input.timingValue * MS_PER_DAY
      );

    case "AFTER_STEP":
      if (!input.predecessorCompletedAt) return null;
      // Same instant as the predecessor's completion. timingValue is
      // ignored for AFTER_STEP — the relationship is the FK, not a delay.
      return input.predecessorCompletedAt;

    default: {
      // Exhaustiveness check — TS narrows `never` here when we've
      // covered every WorkflowTimingType, so a new enum member that
      // isn't handled becomes a compile error.
      const _exhaustive: never = input.timingType;
      void _exhaustive;
      return null;
    }
  }
}

/**
 * Pretty-print a timing rule for the editor's step row. The form
 * `(Day -7)` / `(Day +0)` / `(7 days before target)` mirrors how the
 * spec's seeded templates phrase their schedules.
 */
export function describeTiming(
  timingType: WorkflowTimingType,
  timingValue: number,
  hasAfterStep: boolean
): string {
  switch (timingType) {
    case "ON_ENTRY":
      return "On entry";
    case "DAYS_AFTER_START": {
      if (timingValue === 0) return "Day 0 (start)";
      const sign = timingValue > 0 ? "+" : "−";
      return `Day ${sign}${Math.abs(timingValue)}`;
    }
    case "DAYS_BEFORE_TARGET": {
      if (timingValue === 0) return "Target day";
      return `${timingValue} day${timingValue === 1 ? "" : "s"} before target`;
    }
    case "AFTER_STEP":
      return hasAfterStep ? "After previous step" : "After step (unset)";
    default:
      return "On entry";
  }
}
