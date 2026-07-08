"use server";

import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { revalidatePath } from "next/cache";
import { revalidateProject } from "@/lib/revalidate-entity";
import { z } from "zod";
import { nameField } from "@/lib/validation";
import { BID_STATUSES } from "@/lib/bids";
import type { BidStatus } from "@prisma/client";

/**
 * Bid pipeline actions. "bids" is a permissioned module (Manager+ by
 * default — bid values are financial data, so the field tier is denied
 * unless explicitly granted; bids are not an entity-scoped type).
 *
 * Stage bookkeeping: moving to SUBMITTED stamps submittedAt; moving to
 * any outcome (WON/LOST/NO_BID/STALE) stamps decidedAt; moving back
 * into an open stage clears decidedAt so a reopened bid reads as live.
 * Changing the due date re-arms the bid-due-check notification.
 */

function revalidateBid(id?: string) {
  revalidatePath("/bids");
  revalidatePath("/bids/portals");
  if (id) revalidatePath(`/bids/${id}`);
  revalidatePath("/dashboard");
}

/** FormData accessor: empty string / missing → undefined (zod optional). */
function optField(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  return value === null || value === "" ? undefined : String(value);
}

// ─── Portals ──────────────────────────────────────────────────────

const portalSchema = z.object({
  name: nameField({ label: "Name", max: 200 }),
  url: z.string().url("Enter a full URL (https://…)").optional(),
  jurisdiction: z.string().max(200).optional(),
  accountIdentifier: z.string().max(200).optional(),
  registrationRenewsAt: z.string().optional(),
  isActive: z.boolean().optional(),
  notes: z.string().max(10000).optional(),
});

function parsePortalForm(formData: FormData) {
  return portalSchema.safeParse({
    name: formData.get("name"),
    url: optField(formData, "url"),
    jurisdiction: optField(formData, "jurisdiction"),
    accountIdentifier: optField(formData, "accountIdentifier"),
    registrationRenewsAt: optField(formData, "registrationRenewsAt"),
    isActive: formData.get("isActive") !== "false",
    notes: optField(formData, "notes"),
  });
}

function portalData(data: z.infer<typeof portalSchema>) {
  return {
    name: data.name,
    url: data.url?.trim() || null,
    jurisdiction: data.jurisdiction?.trim() || null,
    accountIdentifier: data.accountIdentifier?.trim() || null,
    registrationRenewsAt: data.registrationRenewsAt ? new Date(data.registrationRenewsAt) : null,
    isActive: data.isActive ?? true,
    notes: data.notes?.trim() || null,
  };
}

export async function createBidPortal(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "bids");
  if (!perms.canCreate) return { error: "Permission denied" };

  const parsed = parsePortalForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.errors[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const portal = await db.bidPortal.create({ data: portalData(parsed.data) });
  await logActivity("created", "bid-portal", portal.id, user.id, portal.name);
  revalidateBid();
  return { success: true };
}

export async function updateBidPortal(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "bids");
  if (!perms.canEdit) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  if (!id) return { error: "ID required" };
  const parsed = parsePortalForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.errors[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const existing = await db.bidPortal.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return { error: "Not found" };

  const portal = await db.bidPortal.update({ where: { id }, data: portalData(parsed.data) });
  await logActivity("updated", "bid-portal", id, user.id, portal.name);
  revalidateBid();
  return { success: true };
}

export async function deleteBidPortal(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "bids");
  if (!perms.canDelete) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  const portal = await db.bidPortal.findUnique({
    where: { id },
    select: { id: true, name: true },
  });
  if (!portal) return { error: "Not found" };

  // Opportunities keep their history — portalId just goes null (FK SetNull).
  await db.bidPortal.delete({ where: { id } });
  await logActivity("deleted", "bid-portal", id, user.id, portal.name);
  revalidateBid();
  return { success: true };
}

// ─── Opportunities ────────────────────────────────────────────────

const bidSchema = z.object({
  title: nameField({ label: "Title", max: 300 }),
  solicitationNumber: z.string().max(100).optional(),
  agency: z.string().max(300).optional(),
  url: z.string().url("Enter a full URL (https://…)").optional(),
  description: z.string().max(10000).optional(),
  estimatedValue: z.coerce.number().min(0).optional(),
  status: z.enum(BID_STATUSES as [BidStatus, ...BidStatus[]]).optional(),
  dueDate: z.string().optional(),
  portalId: z.string().optional(),
  clientId: z.string().optional(),
  ownerId: z.string().optional(),
  lossReason: z.string().max(1000).optional(),
  notes: z.string().max(10000).optional(),
});

function parseBidForm(formData: FormData) {
  return bidSchema.safeParse({
    title: formData.get("title"),
    solicitationNumber: optField(formData, "solicitationNumber"),
    agency: optField(formData, "agency"),
    url: optField(formData, "url"),
    description: optField(formData, "description"),
    estimatedValue: optField(formData, "estimatedValue"),
    status: optField(formData, "status"),
    dueDate: optField(formData, "dueDate"),
    portalId: optField(formData, "portalId"),
    clientId: optField(formData, "clientId"),
    ownerId: optField(formData, "ownerId"),
    lossReason: optField(formData, "lossReason"),
    notes: optField(formData, "notes"),
  });
}

const OUTCOME_STATUSES: BidStatus[] = ["WON", "LOST", "NO_BID", "STALE"];

/**
 * Stage-transition bookkeeping shared by update + inline status change.
 * Returns the field patches implied by moving `from` → `to`.
 */
function stageStamps(
  from: BidStatus,
  to: BidStatus,
  existing: { submittedAt: Date | null; decidedAt: Date | null }
) {
  if (from === to) return {};
  const patch: Record<string, Date | null> = {};
  if (to === "SUBMITTED" && !existing.submittedAt) patch.submittedAt = new Date();
  if (OUTCOME_STATUSES.includes(to)) {
    if (!existing.decidedAt) patch.decidedAt = new Date();
  } else {
    // Reopened (moved back into the live pipeline).
    patch.decidedAt = null;
  }
  return patch;
}

export async function createBid(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "bids");
  if (!perms.canCreate) return { error: "Permission denied" };

  const parsed = parseBidForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.errors[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  const bid = await db.bidOpportunity.create({
    data: {
      title: data.title,
      solicitationNumber: data.solicitationNumber?.trim() || null,
      agency: data.agency?.trim() || null,
      url: data.url?.trim() || null,
      description: data.description?.trim() || null,
      estimatedValue: data.estimatedValue ?? null,
      status: data.status ?? "IDENTIFIED",
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      submittedAt: data.status === "SUBMITTED" ? new Date() : null,
      portalId: data.portalId || null,
      clientId: data.clientId || null,
      ownerId: data.ownerId || user.id,
      lossReason: data.lossReason?.trim() || null,
      notes: data.notes?.trim() || null,
    },
  });

  await logActivity("created", "bid", bid.id, user.id, bid.title);
  revalidateBid();
  return { success: true, id: bid.id };
}

export async function updateBid(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "bids");
  if (!perms.canEdit) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  if (!id) return { error: "ID required" };
  const parsed = parseBidForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.errors[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  const existing = await db.bidOpportunity.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, status: true, submittedAt: true, decidedAt: true, dueDate: true },
  });
  if (!existing) return { error: "Not found" };

  const nextStatus = data.status ?? existing.status;
  const nextDueDate = data.dueDate ? new Date(data.dueDate) : null;
  const dueDateChanged =
    (existing.dueDate?.getTime() ?? null) !== (nextDueDate?.getTime() ?? null);

  const bid = await db.bidOpportunity.update({
    where: { id },
    data: {
      title: data.title,
      solicitationNumber: data.solicitationNumber?.trim() || null,
      agency: data.agency?.trim() || null,
      url: data.url?.trim() || null,
      description: data.description?.trim() || null,
      estimatedValue: data.estimatedValue ?? null,
      status: nextStatus,
      dueDate: nextDueDate,
      portalId: data.portalId || null,
      clientId: data.clientId || null,
      ownerId: data.ownerId || null,
      lossReason: data.lossReason?.trim() || null,
      notes: data.notes?.trim() || null,
      ...stageStamps(existing.status, nextStatus, existing),
      // A new deadline re-arms the due-soon notification.
      ...(dueDateChanged ? { dueNotifiedFor: null } : {}),
    },
  });

  await logActivity("updated", "bid", id, user.id, bid.title);
  revalidateBid(id);
  return { success: true };
}

/** Quick stage move from the detail page — everything else untouched. */
export async function updateBidStatusInline(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "bids");
  if (!perms.canEdit) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  const status = formData.get("status") as BidStatus;
  if (!id || !BID_STATUSES.includes(status)) return { error: "Invalid stage" };

  const existing = await db.bidOpportunity.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, title: true, status: true, submittedAt: true, decidedAt: true },
  });
  if (!existing) return { error: "Not found" };
  if (existing.status === status) return { success: true };

  await db.bidOpportunity.update({
    where: { id },
    data: { status, ...stageStamps(existing.status, status, existing) },
  });
  await logActivity(
    "updated",
    "bid",
    id,
    user.id,
    `${existing.title} → ${status.toLowerCase().replace("_", " ")}`
  );
  revalidateBid(id);
  return { success: true };
}

export async function deleteBid(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "bids");
  if (!perms.canDelete) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  const bid = await db.bidOpportunity.findUnique({ where: { id } });
  if (!bid) return { error: "Not found" };
  if (bid.deletedAt) return { error: "Already in the recovery bin" };

  await db.bidOpportunity.update({ where: { id }, data: { deletedAt: new Date() } });
  await logActivity("soft-deleted", "bid", id, user.id, bid.title);
  revalidateBid();
  return { success: true };
}

/**
 * Won the work → hand off to delivery. Creates a PLANNING project from
 * the bid, links it back (bid.projectId), and stamps the bid WON.
 * Needs create rights on BOTH modules — a bid editor without projects
 * canCreate can't mint projects through the side door.
 */
export async function convertBidToProject(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const [bidPerms, projectPerms] = await Promise.all([
    resolveModulePerms(user.id, user.role, "bids"),
    resolveModulePerms(user.id, user.role, "projects"),
  ]);
  if (!bidPerms.canEdit) return { error: "Permission denied" };
  if (!projectPerms.canCreate) return { error: "You need project-create permission to convert a bid" };

  const id = formData.get("id") as string;
  const name = ((formData.get("name") as string) || "").trim();
  const clientId = ((formData.get("clientId") as string) || "").trim();
  if (!id) return { error: "ID required" };
  if (!name) return { error: "Project name is required" };
  if (!clientId) return { error: "Pick the client this project belongs to" };

  const bid = await db.bidOpportunity.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, title: true, description: true, projectId: true, decidedAt: true, status: true, submittedAt: true },
  });
  if (!bid) return { error: "Not found" };
  if (bid.projectId) return { error: "This bid is already linked to a project" };

  const client = await db.client.findFirst({
    where: { id: clientId, deletedAt: null },
    select: { id: true },
  });
  if (!client) return { error: "Client not found" };

  const project = await db.project.create({
    data: {
      name,
      clientId,
      status: "PLANNING",
      description: bid.description,
      ownerId: user.id,
    },
  });
  await db.bidOpportunity.update({
    where: { id },
    data: {
      status: "WON",
      projectId: project.id,
      clientId,
      decidedAt: bid.decidedAt ?? new Date(),
    },
  });

  await logActivity("created", "project", project.id, user.id, `${name} (from bid: ${bid.title})`);
  await logActivity("updated", "bid", id, user.id, `${bid.title} → won, converted to project`);
  revalidateProject(project.id, { clientId });
  revalidateBid(id);
  return { success: true, projectId: project.id };
}
