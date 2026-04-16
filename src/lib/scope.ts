import { db } from "@/lib/db";
import type { Role } from "@prisma/client";

/**
 * Computed visibility scope for a user. For ADMIN and MANAGER this resolves
 * to "all" — they see everything. For everyone else the IDs are derived from
 * the user's actual relationships: project assignments, staffing allocations,
 * client account-manager rows, and the explicit EntityPermission table.
 *
 * This is the single source of truth for "what entities can this user see"
 * across list pages and detail-page 404 guards. Do not re-derive visibility
 * ad-hoc in page code — call getUserScope() and filter by the returned sets.
 */
export interface UserScope {
  role: Role;
  /** True when the user sees everything org-wide (ADMIN / MANAGER). */
  all: boolean;
  projectIds: Set<string>;
  clientIds: Set<string>;
  contractIds: Set<string>;
  toolIds: Set<string>;
  certIds: Set<string>;
}

const ALL_SCOPE_ROLES: Role[] = ["ADMIN", "MANAGER"];

export function hasOrgWideScope(role: Role): boolean {
  return ALL_SCOPE_ROLES.includes(role);
}

/**
 * Compute the user's visibility scope. Call this once per request and pass
 * the result to whatever needs it — don't call it in a loop.
 */
export async function getUserScope(
  userId: string,
  role: Role
): Promise<UserScope> {
  if (hasOrgWideScope(role)) {
    return {
      role,
      all: true,
      projectIds: new Set(),
      clientIds: new Set(),
      contractIds: new Set(),
      toolIds: new Set(),
      certIds: new Set(),
    };
  }

  // ── Project visibility ────────────────────────────────────────
  // A user sees a project if any of these hold:
  //   - They're a ProjectMember (legacy team relation)
  //   - They have an active or planned Assignment on the project
  //   - They have an explicit EntityPermission row with canView
  const [members, assignments, entityPerms] = await Promise.all([
    db.projectMember.findMany({
      where: { userId },
      select: { projectId: true },
    }),
    db.assignment.findMany({
      where: {
        employeeId: userId,
        status: { in: ["ACTIVE", "PLANNED"] },
      },
      select: { projectId: true, clientId: true },
    }),
    db.entityPermission.findMany({
      where: { userId, canView: true },
      select: { entityType: true, entityId: true },
    }),
  ]);

  const projectIds = new Set<string>();
  for (const m of members) projectIds.add(m.projectId);
  for (const a of assignments) if (a.projectId) projectIds.add(a.projectId);
  for (const p of entityPerms)
    if (p.entityType === "project") projectIds.add(p.entityId);

  // ── Client visibility ─────────────────────────────────────────
  // Clients derive from: accountManagerId, any scoped project's client,
  // explicit entity permissions on the client, and staffing assignments
  // that reference the client directly.
  const clientIds = new Set<string>();
  for (const a of assignments) if (a.clientId) clientIds.add(a.clientId);
  for (const p of entityPerms)
    if (p.entityType === "client") clientIds.add(p.entityId);

  const [managedClients, scopedProjects] = await Promise.all([
    db.client.findMany({
      where: { accountManagerId: userId },
      select: { id: true },
    }),
    projectIds.size > 0
      ? db.project.findMany({
          where: { id: { in: Array.from(projectIds) } },
          select: { clientId: true },
        })
      : Promise.resolve([] as { clientId: string }[]),
  ]);
  for (const c of managedClients) clientIds.add(c.id);
  for (const p of scopedProjects) clientIds.add(p.clientId);

  // ── Certification visibility ──────────────────────────────────
  // Certs visible when the user is the assignee, POC, or when the cert is
  // for a client the user already has access to.
  const certRows = await db.certification.findMany({
    where: {
      OR: [
        { assigneeId: userId },
        { pointOfContactId: userId },
        ...(clientIds.size > 0
          ? [{ clientId: { in: Array.from(clientIds) } }]
          : []),
      ],
    },
    select: { id: true },
  });
  const certIds = new Set(certRows.map((c) => c.id));

  // ── Contract visibility ───────────────────────────────────────
  // Contracts ride on top of projects + clients. If a user can see the
  // project or client, they can see the contract.
  const contractIds = new Set<string>();
  if (projectIds.size > 0 || clientIds.size > 0) {
    const contracts = await db.contract.findMany({
      where: {
        OR: [
          ...(projectIds.size > 0
            ? [{ projectId: { in: Array.from(projectIds) } }]
            : []),
          ...(clientIds.size > 0
            ? [{ clientId: { in: Array.from(clientIds) } }]
            : []),
        ],
      },
      select: { id: true },
    });
    for (const c of contracts) contractIds.add(c.id);
  }

  // ── Tool visibility ───────────────────────────────────────────
  // Tools are attached to projects via ProjectTool. A tool is visible if
  // it's linked to at least one project the user can see.
  const toolIds = new Set<string>();
  if (projectIds.size > 0) {
    const projectTools = await db.projectTool.findMany({
      where: { projectId: { in: Array.from(projectIds) } },
      select: { toolId: true },
    });
    for (const pt of projectTools) toolIds.add(pt.toolId);
  }

  return {
    role,
    all: false,
    projectIds,
    clientIds,
    contractIds,
    toolIds,
    certIds,
  };
}

/**
 * Guard helper for detail pages. Returns true when the user can view the
 * given entity under their computed scope. ADMIN / MANAGER always pass.
 */
export function canViewEntity(
  scope: UserScope,
  entityType: "project" | "client" | "contract" | "tool" | "certification",
  id: string
): boolean {
  if (scope.all) return true;
  switch (entityType) {
    case "project":
      return scope.projectIds.has(id);
    case "client":
      return scope.clientIds.has(id);
    case "contract":
      return scope.contractIds.has(id);
    case "tool":
      return scope.toolIds.has(id);
    case "certification":
      return scope.certIds.has(id);
  }
}
