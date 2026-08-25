"use server";

import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { nameField, rejectHtmlChars, HTML_CHARS_MESSAGE } from "@/lib/validation";
import {
  CONTACT_ENTITY_BASE_PATHS,
  MAX_ROLE_TAGS_PER_LINK,
  MAX_ROLE_TAG_LENGTH,
  isContactEntityType,
  type ContactEntityType,
} from "@/lib/contacts";

/**
 * Server actions for the unified Contacts module.
 *
 * Write gate: contacts span every module (a person can sit on a
 * supplier AND a project), so instead of a per-module gate the writes
 * use the clients module's canEdit as the single "can maintain the
 * rolodex" flag. ADMIN (and DEVELOPER via hasOrgWideManage) always
 * pass; MANAGER passes via role defaults. Merging is destructive
 * across records and stays ADMIN-only.
 *
 * Reads (searchContacts and the /contacts pages) use clients canView.
 */

const CONTACTS_WRITE_MODULE = "clients";

// ─── Validation ───────────────────────────────────────────────────

const contactSchema = z.object({
  name: nameField({ label: "Name" }),
  title: z.string().trim().max(200, "Title must be at most 200 characters").optional(),
  email: z
    .string()
    .trim()
    .email("Enter a valid email address")
    .max(320, "Email must be at most 320 characters")
    .optional(),
  phone: z.string().trim().max(50, "Phone must be at most 50 characters").optional(),
  organization: z
    .string()
    .trim()
    .max(200, "Organization must be at most 200 characters")
    .optional(),
  notes: z.string().max(10_000, "Notes are too long").optional(),
});

export interface ContactInput {
  name: string;
  title?: string;
  email?: string;
  phone?: string;
  organization?: string;
  notes?: string;
}

type ActionResult = {
  success?: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
};

/** Blank strings from controlled inputs become undefined pre-parse. */
function emptyToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeContactInput(input: ContactInput) {
  return {
    name: input.name,
    title: emptyToUndefined(input.title),
    email: emptyToUndefined(input.email),
    phone: emptyToUndefined(input.phone),
    organization: emptyToUndefined(input.organization),
    notes: input.notes?.trim() ? input.notes : undefined,
  };
}

/**
 * Normalize a roles tag list: trim, drop empties, dedupe
 * case-insensitively (first spelling wins), cap tag length and count.
 * Returns { error } instead of silently truncating an over-limit tag.
 */
function normalizeRoles(roles: string[] | undefined): { roles: string[] } | { error: string } {
  if (!roles) return { roles: [] };
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of roles) {
    const tag = raw.trim();
    if (!tag) continue;
    if (tag.length > MAX_ROLE_TAG_LENGTH) {
      return { error: `Role tags must be at most ${MAX_ROLE_TAG_LENGTH} characters` };
    }
    if (!rejectHtmlChars(tag)) return { error: HTML_CHARS_MESSAGE };
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  if (out.length > MAX_ROLE_TAGS_PER_LINK) {
    return { error: `At most ${MAX_ROLE_TAGS_PER_LINK} role tags per link` };
  }
  return { roles: out };
}

// ─── Revalidation ─────────────────────────────────────────────────

/**
 * Invalidate the pages a link's entity side renders contacts on. The
 * id-path covers cuid URLs; the layout-mode base path also covers
 * slug URLs (clients / projects detail pages resolve by slug OR id).
 */
function revalidateEntityPages(entityType: ContactEntityType, entityId: string) {
  const base = CONTACT_ENTITY_BASE_PATHS[entityType];
  revalidatePath(`${base}/${entityId}`);
  revalidatePath(base, "layout");
}

/** Invalidate /contacts, the contact's detail page, and every linked entity page. */
async function revalidateContactPages(contactId: string) {
  revalidatePath("/contacts");
  revalidatePath(`/contacts/${contactId}`);
  const links = await db.contactLink.findMany({
    where: { contactId },
    select: { entityType: true, entityId: true },
  });
  const seenTypes = new Set<string>();
  for (const link of links) {
    if (!isContactEntityType(link.entityType)) continue;
    revalidatePath(`${CONTACT_ENTITY_BASE_PATHS[link.entityType]}/${link.entityId}`);
    seenTypes.add(link.entityType);
  }
  for (const type of Array.from(seenTypes)) {
    revalidatePath(CONTACT_ENTITY_BASE_PATHS[type as ContactEntityType], "layout");
  }
}

// ─── Target existence guard ───────────────────────────────────────

/**
 * Per-type existence + soft-delete guard for link targets. ContactLink
 * has no FK, so a bad id would otherwise create a permanently dangling
 * row that every read path then has to skip.
 */
async function linkTargetExists(
  entityType: ContactEntityType,
  entityId: string
): Promise<boolean> {
  const where = { id: entityId, deletedAt: null };
  const select = { id: true } as const;
  switch (entityType) {
    case "client":
      return !!(await db.client.findFirst({ where, select }));
    case "supplier":
      return !!(await db.supplier.findFirst({ where, select }));
    case "subcontractor":
      return !!(await db.subcontractor.findFirst({ where, select }));
    case "partnership":
      return !!(await db.partnership.findFirst({ where, select }));
    case "bid":
      return !!(await db.bidOpportunity.findFirst({ where, select }));
    case "project":
      return !!(await db.project.findFirst({ where, select }));
    case "contract":
      return !!(await db.contract.findFirst({ where, select }));
  }
}

// ─── Contact CRUD ─────────────────────────────────────────────────

export async function createContact(
  input: ContactInput
): Promise<ActionResult & { contactId?: string }> {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, CONTACTS_WRITE_MODULE);
  if (!perms.canEdit) return { error: "Permission denied" };

  const parsed = contactSchema.safeParse(normalizeContactInput(input));
  if (!parsed.success) {
    return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const contact = await db.contact.create({
    data: {
      name: parsed.data.name,
      title: parsed.data.title ?? null,
      email: parsed.data.email ?? null,
      phone: parsed.data.phone ?? null,
      organization: parsed.data.organization ?? null,
      notes: parsed.data.notes ?? null,
    },
  });
  await logActivity("created", "contact", contact.id, user.id, contact.name);
  revalidatePath("/contacts");
  return { success: true, contactId: contact.id };
}

export async function updateContact(
  id: string,
  input: ContactInput & { isFormer?: boolean }
): Promise<ActionResult> {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, CONTACTS_WRITE_MODULE);
  if (!perms.canEdit) return { error: "Permission denied" };

  // Existence + soft-delete guard: a missing id would throw P2025 (→ 500)
  // and a soft-deleted contact must not be editable from a stale form.
  const existing = await db.contact.findFirst({
    where: { id, deletedAt: null },
    select: { id: true },
  });
  if (!existing) return { error: "Not found" };

  const parsed = contactSchema.safeParse(normalizeContactInput(input));
  if (!parsed.success) {
    return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  await db.contact.update({
    where: { id },
    data: {
      name: parsed.data.name,
      title: parsed.data.title ?? null,
      email: parsed.data.email ?? null,
      phone: parsed.data.phone ?? null,
      organization: parsed.data.organization ?? null,
      notes: parsed.data.notes ?? null,
      isFormer: !!input.isFormer,
    },
  });
  await logActivity("updated", "contact", id, user.id, parsed.data.name);
  await revalidateContactPages(id);
  return { success: true };
}

export async function softDeleteContact(id: string): Promise<ActionResult> {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, CONTACTS_WRITE_MODULE);
  if (!perms.canEdit) return { error: "Permission denied" };

  const contact = await db.contact.findUnique({
    where: { id },
    select: { id: true, name: true, deletedAt: true },
  });
  if (!contact) return { error: "Not found" };
  if (contact.deletedAt) return { error: "Contact is already deleted" };

  // Links are kept intentionally — restoring the contact restores the
  // full relationship graph; read paths filter on contact.deletedAt.
  await db.contact.update({ where: { id }, data: { deletedAt: new Date() } });
  await logActivity("deleted", "contact", id, user.id, contact.name);
  await revalidateContactPages(id);
  return { success: true };
}

/**
 * The "Mark as departed" toggle on the contact detail page. Kept
 * separate from updateContact (which replaces the whole field set) so
 * the toggle can't clobber concurrent edits. Departed contacts keep
 * their history and links but disappear from pickers and copy lists;
 * their notes stay visible (they often carry mailbox-redirect info).
 */
export async function setContactFormer(id: string, isFormer: boolean): Promise<ActionResult> {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, CONTACTS_WRITE_MODULE);
  if (!perms.canEdit) return { error: "Permission denied" };

  const contact = await db.contact.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!contact) return { error: "Not found" };

  await db.contact.update({ where: { id }, data: { isFormer } });
  await logActivity("updated", "contact", id, user.id, contact.name);
  await revalidateContactPages(id);
  return { success: true };
}

// ─── Links ────────────────────────────────────────────────────────

export async function linkContact(
  contactId: string,
  entityType: string,
  entityId: string,
  roles?: string[],
  isPrimary?: boolean
): Promise<ActionResult> {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, CONTACTS_WRITE_MODULE);
  if (!perms.canEdit) return { error: "Permission denied" };

  if (!isContactEntityType(entityType)) return { error: "Unknown entity type" };
  if (!entityId) return { error: "Not found" };

  const normalized = normalizeRoles(roles);
  if ("error" in normalized) return { error: normalized.error };

  const [contact, targetOk] = await Promise.all([
    db.contact.findFirst({
      where: { id: contactId, deletedAt: null },
      select: { id: true, name: true },
    }),
    linkTargetExists(entityType, entityId),
  ]);
  if (!contact || !targetOk) return { error: "Not found" };

  if (isPrimary) {
    // One primary person per entity — demote any other primary link.
    await db.contactLink.updateMany({
      where: { entityType, entityId, isPrimary: true, contactId: { not: contactId } },
      data: { isPrimary: false },
    });
  }

  // Upsert on the unique triple so re-linking an existing pair updates
  // the role tags / primary flag instead of throwing P2002.
  await db.contactLink.upsert({
    where: { contactId_entityType_entityId: { contactId, entityType, entityId } },
    create: {
      contactId,
      entityType,
      entityId,
      roles: normalized.roles,
      isPrimary: !!isPrimary,
    },
    update: { roles: normalized.roles, isPrimary: !!isPrimary },
  });

  revalidateEntityPages(entityType, entityId);
  revalidatePath("/contacts");
  revalidatePath(`/contacts/${contactId}`);
  return { success: true };
}

export async function unlinkContact(linkId: string): Promise<ActionResult> {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, CONTACTS_WRITE_MODULE);
  if (!perms.canEdit) return { error: "Permission denied" };

  // Look up the link first — a stale double-submit would otherwise throw
  // P2025 (→ 500), and we need both sides for revalidation anyway.
  const link = await db.contactLink.findUnique({ where: { id: linkId } });
  if (!link) return { error: "Not found" };

  await db.contactLink.delete({ where: { id: linkId } });

  if (isContactEntityType(link.entityType)) {
    revalidateEntityPages(link.entityType, link.entityId);
  }
  revalidatePath("/contacts");
  revalidatePath(`/contacts/${link.contactId}`);
  return { success: true };
}

export async function updateContactLink(
  linkId: string,
  input: { roles?: string[]; isPrimary?: boolean }
): Promise<ActionResult> {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, CONTACTS_WRITE_MODULE);
  if (!perms.canEdit) return { error: "Permission denied" };

  const link = await db.contactLink.findUnique({ where: { id: linkId } });
  if (!link) return { error: "Not found" };

  const data: { roles?: string[]; isPrimary?: boolean } = {};
  if (input.roles !== undefined) {
    const normalized = normalizeRoles(input.roles);
    if ("error" in normalized) return { error: normalized.error };
    data.roles = normalized.roles;
  }
  if (input.isPrimary !== undefined) {
    data.isPrimary = input.isPrimary;
    if (input.isPrimary) {
      await db.contactLink.updateMany({
        where: {
          entityType: link.entityType,
          entityId: link.entityId,
          isPrimary: true,
          id: { not: linkId },
        },
        data: { isPrimary: false },
      });
    }
  }

  await db.contactLink.update({ where: { id: linkId }, data });

  if (isContactEntityType(link.entityType)) {
    revalidateEntityPages(link.entityType, link.entityId);
  }
  revalidatePath(`/contacts/${link.contactId}`);
  return { success: true };
}

// ─── Merge ────────────────────────────────────────────────────────

/**
 * Merge one contact into another (ADMIN only — the backfill deduped by
 * email, but people entered twice with different emails need a manual
 * merge). Links move to the keeper unless the keeper already has a
 * link to the same entity (unique triple); blank keeper fields are
 * filled from the merged contact; the merged contact is soft-deleted
 * so the merge is recoverable.
 */
export async function mergeContacts(keepId: string, mergeId: string): Promise<ActionResult> {
  const user = await requireAuth();
  if (user.role !== "ADMIN") return { error: "Permission denied" };
  if (!keepId || !mergeId || keepId === mergeId) {
    return { error: "Pick two different contacts to merge" };
  }

  const [keeper, merged] = await Promise.all([
    db.contact.findFirst({ where: { id: keepId, deletedAt: null } }),
    db.contact.findFirst({ where: { id: mergeId, deletedAt: null } }),
  ]);
  if (!keeper || !merged) return { error: "Not found" };

  await db.$transaction(async (tx) => {
    const [keeperLinks, mergedLinks] = await Promise.all([
      tx.contactLink.findMany({
        where: { contactId: keepId },
        select: { entityType: true, entityId: true },
      }),
      tx.contactLink.findMany({ where: { contactId: mergeId } }),
    ]);
    const keeperPairs = new Set(keeperLinks.map((l) => `${l.entityType}:${l.entityId}`));

    for (const link of mergedLinks) {
      // Skip pairs the keeper already covers (would violate the unique
      // triple); the duplicate stays on the soft-deleted contact.
      if (keeperPairs.has(`${link.entityType}:${link.entityId}`)) continue;
      await tx.contactLink.update({
        where: { id: link.id },
        data: { contactId: keepId },
      });
      keeperPairs.add(`${link.entityType}:${link.entityId}`);
    }

    // Fill the keeper's blank fields from the merged contact — never
    // overwrite a value the keeper already has.
    await tx.contact.update({
      where: { id: keepId },
      data: {
        title: keeper.title ?? merged.title,
        email: keeper.email ?? merged.email,
        phone: keeper.phone ?? merged.phone,
        organization: keeper.organization ?? merged.organization,
        notes: keeper.notes ?? merged.notes,
      },
    });

    await tx.contact.update({
      where: { id: mergeId },
      data: { deletedAt: new Date() },
    });
  });

  await logActivity(
    "merged",
    "contact",
    keepId,
    user.id,
    `${merged.name} → ${keeper.name}`
  );
  await revalidateContactPages(keepId);
  revalidatePath(`/contacts/${mergeId}`);
  return { success: true };
}

// ─── Picker searches ──────────────────────────────────────────────

export interface ContactSearchHit {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  organization: string | null;
  isFormer: boolean;
}

/**
 * Contact picker search (add-person / add-link dialogs, merge dialog).
 * Name/email contains. Departed people are EXCLUDED by default —
 * pickers and copy lists must not offer them; pass includeFormer for
 * the merge dialog (a duplicate being cleaned up may itself be
 * departed), where they sort last.
 */
export async function searchContacts(
  query: string,
  opts?: { includeFormer?: boolean }
): Promise<ContactSearchHit[]> {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, CONTACTS_WRITE_MODULE);
  if (!perms.canView) return [];

  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const ci = { contains: trimmed, mode: "insensitive" as const };
  return db.contact.findMany({
    where: {
      deletedAt: null,
      ...(opts?.includeFormer ? {} : { isFormer: false }),
      OR: [{ name: ci }, { email: ci }],
    },
    select: {
      id: true,
      name: true,
      title: true,
      email: true,
      organization: true,
      isFormer: true,
    },
    orderBy: [{ isFormer: "asc" }, { name: "asc" }],
    take: 20,
  });
}

/** Module key whose canView gates target lookups for each entity type. */
const MODULE_FOR_ENTITY_TYPE: Record<ContactEntityType, string> = {
  client: "clients",
  supplier: "suppliers",
  subcontractor: "subcontractors",
  partnership: "partnerships",
  bid: "bids",
  project: "projects",
  contract: "contracts",
};

/**
 * Target search for the "Add link" picker on the contact detail page:
 * given an entity type, find non-deleted records by name/title. Gated
 * by canView on the target's own module so the picker can't be used
 * to enumerate records the caller couldn't otherwise see.
 */
export async function searchLinkTargets(
  entityType: string,
  query: string
): Promise<{ id: string; name: string }[]> {
  const user = await requireAuth();
  if (!isContactEntityType(entityType)) return [];

  const perms = await resolveModulePerms(user.id, user.role, MODULE_FOR_ENTITY_TYPE[entityType]);
  if (!perms.canView) return [];

  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const ci = { contains: trimmed, mode: "insensitive" as const };
  const take = 10;

  switch (entityType) {
    case "client":
      return db.client.findMany({
        where: { deletedAt: null, name: ci },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
        take,
      });
    case "supplier":
      return db.supplier.findMany({
        where: { deletedAt: null, name: ci },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
        take,
      });
    case "subcontractor":
      return db.subcontractor.findMany({
        where: { deletedAt: null, name: ci },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
        take,
      });
    case "partnership":
      return db.partnership.findMany({
        where: { deletedAt: null, name: ci },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
        take,
      });
    case "bid": {
      const rows = await db.bidOpportunity.findMany({
        where: { deletedAt: null, title: ci },
        select: { id: true, title: true },
        orderBy: { title: "asc" },
        take,
      });
      return rows.map((r) => ({ id: r.id, name: r.title }));
    }
    case "project":
      return db.project.findMany({
        where: { deletedAt: null, name: ci },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
        take,
      });
    case "contract": {
      const rows = await db.contract.findMany({
        where: { deletedAt: null, title: ci },
        select: { id: true, title: true },
        orderBy: { title: "asc" },
        take,
      });
      return rows.map((r) => ({ id: r.id, name: r.title }));
    }
  }
}
