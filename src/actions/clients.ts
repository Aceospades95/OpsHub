"use server";

import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { assertManageEntity } from "@/lib/entity-authz";
import { logActivity } from "@/lib/activity";
import { revalidateClient } from "@/lib/revalidate-entity";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { nameField } from "@/lib/validation";
import { slugify, ensureUniqueSlug } from "@/lib/slug";

const clientSchema = z.object({
  name: nameField({ label: "Name" }),
  description: z.string().optional(),
  summary: z.string().optional(),
  industry: z.string().optional(),
  website: z.string().optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "PROSPECT", "ARCHIVED"]).optional(),
  accountManagerId: z.string().optional(),
  sourceNotes: z.string().optional(),
  openQuestions: z.string().optional(),
});

export async function createClient(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "clients");
  if (!perms.canCreate) return { error: "Permission denied" };

  const parsed = clientSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    summary: formData.get("summary") || undefined,
    sourceNotes: formData.get("sourceNotes") || undefined,
    openQuestions: formData.get("openQuestions") || undefined,
    industry: formData.get("industry") || undefined,
    website: formData.get("website") || undefined,
    status: formData.get("status") || "ACTIVE",
  });

  if (!parsed.success) return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };

  // Round-8 QA: generate a URL-friendly slug at create time so the
  // detail page renders /clients/<slug> instead of /clients/<cuid>.
  // The cuid still resolves via the slug-or-id fallback in the
  // detail page resolver.
  const slug = await ensureUniqueSlug(slugify(parsed.data.name), async (s) => {
    const taken = await db.client.findUnique({ where: { slug: s }, select: { id: true } });
    return taken !== null;
  });

  const client = await db.client.create({ data: { ...parsed.data, slug } });
  await logActivity("created", "client", client.id, user.id, client.name, { clientId: client.id });
  revalidateClient(client.id);
  return { success: true };
}

export async function updateClient(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "clients");
  if (!perms.canEdit) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  const parsed = clientSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    summary: formData.get("summary") || undefined,
    sourceNotes: formData.get("sourceNotes") || undefined,
    openQuestions: formData.get("openQuestions") || undefined,
    industry: formData.get("industry") || undefined,
    website: formData.get("website") || undefined,
    status: formData.get("status") || undefined,
    accountManagerId: formData.get("accountManagerId") || undefined,
  });

  if (!parsed.success) return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };

  // Existence + soft-delete guard: a missing id would throw P2025 (→ 500)
  // and a soft-deleted client must not be editable from a stale form.
  const existing = await db.client.findFirst({
    where: { id, deletedAt: null },
    select: { id: true },
  });
  if (!existing) return { error: "Not found" };

  // Entity-scope write gate — module canEdit alone would let any
  // CONTRIBUTOR mutate arbitrary clients by id.
  const denied = await assertManageEntity(user.id, user.role, "client", id);
  if (denied) return { error: denied.error };

  await db.client.update({
    where: { id },
    data: {
      ...parsed.data,
      accountManagerId: parsed.data.accountManagerId || null,
    },
  });
  await logActivity("updated", "client", id, user.id, parsed.data.name, { clientId: id });
  revalidateClient(id);
  return { success: true };
}

export async function deleteClient(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "clients");
  if (!perms.canDelete) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  const client = await db.client.findUnique({ where: { id } });
  if (!client) return { error: "Client not found" };
  if (client.deletedAt) {
    return { error: "Already in the recovery bin" };
  }

  const denied = await assertManageEntity(user.id, user.role, "client", id);
  if (denied) return { error: denied.error };

  await db.client.update({ where: { id }, data: { deletedAt: new Date() } });
  await logActivity("soft-deleted", "client", id, user.id, client.name, { clientId: id });
  revalidateClient(id, { deleted: true });
  return { success: true };
}

// Client Contacts
const contactSchema = z.object({
  name: nameField({ label: "Name" }),
  title: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  isPrimary: z.boolean().optional(),
  notes: z.string().optional(),
  clientId: z.string(),
});

export async function createContact(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "clients");
  if (!perms.canEdit) return { error: "Permission denied" };

  const parsed = contactSchema.safeParse({
    name: formData.get("name"),
    title: formData.get("title") || undefined,
    email: formData.get("email") || undefined,
    phone: formData.get("phone") || undefined,
    isPrimary: formData.get("isPrimary") === "true",
    notes: formData.get("notes") || undefined,
    clientId: formData.get("clientId"),
  });

  if (!parsed.success) return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };

  // Contacts hang off a client — verify the parent exists (and isn't
  // soft-deleted), then gate on it.
  const parentClient = await db.client.findFirst({
    where: { id: parsed.data.clientId, deletedAt: null },
    select: { id: true },
  });
  if (!parentClient) return { error: "Not found" };

  const denied = await assertManageEntity(user.id, user.role, "client", parsed.data.clientId);
  if (denied) return { error: denied.error };

  // Unset other primaries if this one is primary
  if (parsed.data.isPrimary) {
    await db.clientContact.updateMany({
      where: { clientId: parsed.data.clientId, isPrimary: true },
      data: { isPrimary: false },
    });
  }

  await db.clientContact.create({ data: parsed.data });
  revalidatePath(`/clients/${parsed.data.clientId}`);
  return { success: true };
}

export async function updateContact(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "clients");
  if (!perms.canEdit) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  const clientId = formData.get("clientId") as string;
  const parsed = contactSchema.safeParse({
    name: formData.get("name"),
    title: formData.get("title") || undefined,
    email: formData.get("email") || undefined,
    phone: formData.get("phone") || undefined,
    isPrimary: formData.get("isPrimary") === "true",
    notes: formData.get("notes") || undefined,
    clientId,
  });

  if (!parsed.success) return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };

  // Look up the contact to resolve its real parent client, then gate on
  // it. If the form re-parents the contact, gate on the new client too.
  const contact = await db.clientContact.findUnique({
    where: { id },
    select: { clientId: true },
  });
  if (!contact) return { error: "Not found" };

  const denied = await assertManageEntity(user.id, user.role, "client", contact.clientId);
  if (denied) return { error: denied.error };
  if (parsed.data.clientId !== contact.clientId) {
    const deniedNew = await assertManageEntity(user.id, user.role, "client", parsed.data.clientId);
    if (deniedNew) return { error: deniedNew.error };
  }

  if (parsed.data.isPrimary) {
    await db.clientContact.updateMany({
      where: { clientId, isPrimary: true, NOT: { id } },
      data: { isPrimary: false },
    });
  }

  await db.clientContact.update({ where: { id }, data: parsed.data });
  revalidatePath(`/clients/${clientId}`);
  return { success: true };
}

export async function deleteContact(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "clients");
  if (!perms.canEdit) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  const contact = await db.clientContact.findUnique({ where: { id } });
  if (!contact) return { error: "Contact not found" };

  const denied = await assertManageEntity(user.id, user.role, "client", contact.clientId);
  if (denied) return { error: denied.error };

  await db.clientContact.delete({ where: { id } });
  revalidatePath(`/clients/${contact.clientId}`);
  return { success: true };
}
