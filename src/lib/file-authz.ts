/**
 * Per-entity authorization for file reads.
 *
 * Pre-R11, /api/files/[id] only checked "is the request authenticated"
 * for private files — any signed-in user could read any private file
 * just by guessing the cuid. This helper resolves the file's parent
 * entity (project / contract / supplier / etc.) and re-uses the same
 * permission check that the parent's own page runs.
 *
 * Public files (file.visibility === "public") are not checked here —
 * the route handler short-circuits unauth access for them. This module
 * is exclusively about the private-file read path.
 *
 * Files can carry multiple parent FKs in unusual cases (e.g. a quote
 * PDF whose row also has a projectId set). The user is authorized if
 * they can read AT LEAST ONE of the parents — anything else would
 * deny legitimate access from the secondary path.
 *
 * Files with NO parent FK set (orphan uploads not yet attached to an
 * entity) are readable only by the uploader and admin/developer
 * roles. That's the safe default — the file is in the system, but no
 * module owns it yet, so we can't check module-level permission.
 */

import { db } from "@/lib/db";
import type { Role } from "@prisma/client";
import { resolveModulePerms } from "@/lib/permissions";
import { canViewEntity, getUserScope, hasOrgWideManage } from "@/lib/scope";

export type FileAuthzInput = {
  id: string;
  uploadedById: string;
  visibility: string;
  projectId: string | null;
  contractId: string | null;
  documentId: string | null;
  supplierId: string | null;
  intranetResourceId: string | null;
  certificationId: string | null;
  userId: string | null;
  subcontractorId: string | null;
  partnershipId: string | null;
  bidOpportunityId: string | null;
};

export type FileAuthzResult =
  | { ok: true }
  | { ok: false; reason: "parent_deleted" | "forbidden" };

/**
 * Decide whether `userId`/`role` can read the given private file.
 * Returns `{ ok: false, reason: "parent_deleted" }` when every FK on
 * the file points at a row that has been deleted (or soft-deleted) —
 * the route should map that to 404 rather than 403 because the file
 * is genuinely orphaned. Other denials map to 403.
 */
export async function checkFileReadPermission(
  userId: string,
  role: Role,
  file: FileAuthzInput
): Promise<FileAuthzResult> {
  // Org-wide read (ADMIN / DEVELOPER) bypasses parent-entity walks.
  if (hasOrgWideManage(role)) return { ok: true };

  // The uploader can always read what they uploaded. This matches the
  // intuition behind orphan / draft uploads (e.g. a file picked in the
  // Add Project modal before the project row exists).
  if (file.uploadedById === userId) return { ok: true };

  // Files attached directly to a User profile (resume, employee files
  // tab) — only the user themselves passes here. Admin/Developer were
  // already short-circuited above.
  if (file.userId) {
    if (file.userId === userId) return { ok: true };
    // Fall through — the user could still have read access via a
    // module-level grant (employees), but for a personal-file FK
    // we deliberately do NOT grant read to peers in the org. Other
    // FK paths can still pass below.
  }

  const scope = await getUserScope(userId, role);

  // Track whether we found any parent at all. If every FK points at
  // a row that was deleted, surface 404 rather than 403 so the
  // operator sees the file is genuinely orphaned.
  let foundAnyParent = false;
  let allowedByAny = false;

  // ─── Project ────────────────────────────────────────
  if (file.projectId) {
    const proj = await db.project.findUnique({
      where: { id: file.projectId },
      select: { id: true, deletedAt: true },
    });
    if (proj && !proj.deletedAt) {
      foundAnyParent = true;
      if (canViewEntity(scope, "project", proj.id)) allowedByAny = true;
    }
  }

  // ─── Contract ───────────────────────────────────────
  if (!allowedByAny && file.contractId) {
    const contract = await db.contract.findUnique({
      where: { id: file.contractId },
      select: { id: true, deletedAt: true },
    });
    if (contract && !contract.deletedAt) {
      foundAnyParent = true;
      if (canViewEntity(scope, "contract", contract.id)) allowedByAny = true;
    }
  }

  // ─── Document (chain through to project) ────────────
  if (!allowedByAny && file.documentId) {
    const doc = await db.document.findUnique({
      where: { id: file.documentId },
      select: { id: true, projectId: true, deletedAt: true },
    });
    if (doc && !doc.deletedAt) {
      foundAnyParent = true;
      // Documents without a projectId are org-wide knowledge-base
      // entries — gate them on the documents/intranet module canView.
      if (doc.projectId) {
        if (canViewEntity(scope, "project", doc.projectId)) allowedByAny = true;
      } else {
        const perms = await resolveModulePerms(userId, role, "intranet");
        if (perms.canView) allowedByAny = true;
      }
    }
  }

  // ─── Supplier (module-level) ────────────────────────
  if (!allowedByAny && file.supplierId) {
    const supplier = await db.supplier.findUnique({
      where: { id: file.supplierId },
      select: { id: true },
    });
    if (supplier) {
      foundAnyParent = true;
      const perms = await resolveModulePerms(userId, role, "suppliers");
      if (perms.canView) allowedByAny = true;
    }
  }

  // ─── Bid opportunity (module-level) ─────────────────
  if (!allowedByAny && file.bidOpportunityId) {
    const bid = await db.bidOpportunity.findUnique({
      where: { id: file.bidOpportunityId },
      select: { id: true, deletedAt: true },
    });
    if (bid && !bid.deletedAt) {
      foundAnyParent = true;
      const perms = await resolveModulePerms(userId, role, "bids");
      if (perms.canView) allowedByAny = true;
    }
  }

  // ─── Intranet ───────────────────────────────────────
  if (!allowedByAny && file.intranetResourceId) {
    const ir = await db.intranetResource.findUnique({
      where: { id: file.intranetResourceId },
      select: { id: true },
    });
    if (ir) {
      foundAnyParent = true;
      const perms = await resolveModulePerms(userId, role, "intranet");
      if (perms.canView) allowedByAny = true;
    }
  }

  // ─── Certification ──────────────────────────────────
  if (!allowedByAny && file.certificationId) {
    const cert = await db.certification.findUnique({
      where: { id: file.certificationId },
      select: { id: true, deletedAt: true },
    });
    if (cert && !cert.deletedAt) {
      foundAnyParent = true;
      if (canViewEntity(scope, "certification", cert.id)) allowedByAny = true;
    }
  }

  // ─── Subcontractor ──────────────────────────────────
  if (!allowedByAny && file.subcontractorId) {
    const sub = await db.subcontractor.findUnique({
      where: { id: file.subcontractorId },
      select: { id: true },
    });
    if (sub) {
      foundAnyParent = true;
      const perms = await resolveModulePerms(userId, role, "subcontractors");
      if (perms.canView) allowedByAny = true;
    }
  }

  // ─── Partnership ────────────────────────────────────
  if (!allowedByAny && file.partnershipId) {
    const partnership = await db.partnership.findUnique({
      where: { id: file.partnershipId },
      select: { id: true },
    });
    if (partnership) {
      foundAnyParent = true;
      const perms = await resolveModulePerms(userId, role, "partnerships");
      if (perms.canView) allowedByAny = true;
    }
  }

  // ─── User profile attachment ────────────────────────
  if (!allowedByAny && file.userId) {
    const target = await db.user.findUnique({
      where: { id: file.userId },
      select: { id: true, isActive: true },
    });
    if (target) {
      foundAnyParent = true;
      // Already handled "self" above; org peers don't get personal
      // file access by default.
    }
  }

  // ─── Indirect parent: Quote (file linked via Quote.pdfFileId) ───
  if (!allowedByAny) {
    const quote = await db.quote.findFirst({
      where: { pdfFileId: file.id },
      select: { id: true, deletedAt: true },
    });
    if (quote && !quote.deletedAt) {
      foundAnyParent = true;
      const perms = await resolveModulePerms(userId, role, "quotes");
      if (perms.canView) allowedByAny = true;
    }
  }

  // ─── Indirect parent: WorkflowDocument ──────────────
  if (!allowedByAny) {
    const wd = await db.workflowDocument.findFirst({
      where: { fileId: file.id },
      select: { id: true },
    });
    if (wd) {
      foundAnyParent = true;
      const perms = await resolveModulePerms(userId, role, "workflows");
      if (perms.canView) allowedByAny = true;
    }
  }

  if (allowedByAny) return { ok: true };

  // No FK was set at all (orphan upload), AND the user isn't the
  // uploader, AND they're not org-wide-manage. The file is in the
  // system but no module owns it.
  if (!foundAnyParent) {
    const hasAnyFk =
      file.projectId ||
      file.contractId ||
      file.documentId ||
      file.supplierId ||
      file.intranetResourceId ||
      file.certificationId ||
      file.subcontractorId ||
      file.partnershipId ||
      file.userId;
    if (hasAnyFk) {
      // Every FK pointed at a deleted row.
      return { ok: false, reason: "parent_deleted" };
    }
    // Genuinely orphan upload — nobody but the uploader / admin can read.
    return { ok: false, reason: "forbidden" };
  }

  return { ok: false, reason: "forbidden" };
}
