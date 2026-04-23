import { db } from "@/lib/db";
import type { Role } from "@prisma/client";

/**
 * Roles that get auto-bumped to CONTRIBUTOR when they're given a project
 * assignment or project membership. Anything above CONTRIBUTOR already has
 * enough access and is left alone.
 */
const PROMOTABLE_ROLES: Role[] = ["GUEST", "VIEWER"];

/**
 * Bump the user's role to CONTRIBUTOR if they're currently a GUEST or
 * VIEWER. Their previous role is stashed in promotedFromRole so we can
 * revert them if/when they lose all their assignments.
 *
 * Safe to call unconditionally after any assignment / project-member create.
 */
export async function maybePromoteUserRole(userId: string): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, promotedFromRole: true },
  });
  if (!user) return;
  if (!PROMOTABLE_ROLES.includes(user.role)) return;

  await db.user.update({
    where: { id: userId },
    data: {
      role: "CONTRIBUTOR",
      // Only record the original role on first promotion — don't overwrite
      // an existing promotedFromRole if this somehow fires twice.
      promotedFromRole: user.promotedFromRole ?? user.role,
    },
  });
}

/**
 * If the user was auto-promoted and now has zero remaining scope sources
 * (no active/planned assignments, no project memberships, no entity
 * permissions), revert them to their pre-promotion role.
 *
 * Safe to call unconditionally after any assignment / project-member remove,
 * or after an assignment status flips to COMPLETED / CANCELLED / ON_HOLD.
 */
export async function maybeDemoteUserRole(userId: string): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, promotedFromRole: true },
  });
  if (!user || !user.promotedFromRole) return;

  const [assignmentCount, memberCount, permCount] = await Promise.all([
    db.assignment.count({
      where: {
        employeeId: userId,
        status: { in: ["ACTIVE", "PLANNED"] },
      },
    }),
    db.projectMember.count({ where: { userId } }),
    db.entityPermission.count({ where: { userId, canView: true } }),
  ]);

  if (assignmentCount === 0 && memberCount === 0 && permCount === 0) {
    await db.user.update({
      where: { id: userId },
      data: {
        role: user.promotedFromRole,
        promotedFromRole: null,
      },
    });
  }
}
