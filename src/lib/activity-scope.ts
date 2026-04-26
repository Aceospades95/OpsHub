/**
 * Helper for deriving the project/client scope of an activity log entry
 * from a polymorphic (entityType, entityId) reference.
 *
 * Used by call sites that work on entities they don't naturally have a
 * scope for at hand — comments, documents, cert checklist actions, and
 * other "second-order" mutations. The helper does at most one or two
 * indexed point lookups; activity logging is a write path that already
 * issues at least one INSERT, so the extra cost is negligible.
 *
 * Unknown entity types return an empty object — logActivity will write
 * NULL projectId/clientId for them, which is honest: the change is
 * unscoped.
 */

import { db } from "@/lib/db";

export interface ActivityScope {
  projectId?: string | null;
  clientId?: string | null;
}

export async function deriveActivityScope(
  entityType: string,
  entityId: string
): Promise<ActivityScope> {
  switch (entityType) {
    case "project": {
      const p = await db.project.findUnique({
        where: { id: entityId },
        select: { clientId: true },
      });
      return { projectId: entityId, clientId: p?.clientId ?? null };
    }

    case "client":
      return { clientId: entityId };

    case "contract": {
      const c = await db.contract.findUnique({
        where: { id: entityId },
        select: { clientId: true, projectId: true },
      });
      return { clientId: c?.clientId ?? null, projectId: c?.projectId ?? null };
    }

    case "certification": {
      const c = await db.certification.findUnique({
        where: { id: entityId },
        select: { clientId: true },
      });
      return { clientId: c?.clientId ?? null };
    }

    case "task": {
      const t = await db.task.findUnique({
        where: { id: entityId },
        select: { projectId: true, clientId: true },
      });
      return { projectId: t?.projectId ?? null, clientId: t?.clientId ?? null };
    }

    case "milestone": {
      // Milestone → its project → that project's client. Two indexed
      // point lookups; cheap.
      const m = await db.milestone.findUnique({
        where: { id: entityId },
        select: { projectId: true },
      });
      if (!m?.projectId) return {};
      const proj = await db.project.findUnique({
        where: { id: m.projectId },
        select: { clientId: true },
      });
      return { projectId: m.projectId, clientId: proj?.clientId ?? null };
    }

    case "document": {
      const d = await db.document.findUnique({
        where: { id: entityId },
        select: { projectId: true },
      });
      if (!d?.projectId) return {};
      const proj = await db.project.findUnique({
        where: { id: d.projectId },
        select: { clientId: true },
      });
      return { projectId: d.projectId, clientId: proj?.clientId ?? null };
    }

    // Entities without a project/client scope (supplier, tool, intranet
    // resource, sandbox page, theme, sidebar layout, role definition,
    // service offering, user) deliberately fall through to the default.
    default:
      return {};
  }
}
