import type { Prisma } from "@prisma/client";

/**
 * Task visibility filter — AND this into EVERY query that lists,
 * searches, or renders task content for a viewer.
 *
 * PRIVATE tasks are visible only to their creator and assignee. There
 * is deliberately NO role override: synced personal Google lists
 * default private, and an admin's job is managing the system, not
 * reading personal to-dos. (Server actions enforce the same rule for
 * mutations in actions/tasks.ts.)
 *
 * Aggregate-only counters (dashboard open-task totals, admin census)
 * intentionally skip this filter — they expose a number, never
 * content. Shared surfaces with NO single viewer (custom reports,
 * admin-built widgets) must instead filter to PUBLIC outright — use
 * PUBLIC_TASKS_ONLY.
 */
export function taskVisibilityWhere(userId: string): Prisma.TaskWhereInput {
  return {
    OR: [
      { visibility: "PUBLIC" },
      { createdById: userId },
      { assigneeId: userId },
    ],
  };
}

/** For viewer-less shared surfaces: custom reports, widget builder. */
export const PUBLIC_TASKS_ONLY: Prisma.TaskWhereInput = {
  visibility: "PUBLIC",
};
