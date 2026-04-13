"use server";

import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { revalidateClient } from "@/lib/revalidate-entity";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const clientSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  summary: z.string().optional(),
  industry: z.string().optional(),
  website: z.string().optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "PROSPECT", "ARCHIVED"]).optional(),
  accountManagerId: z.string().optional(),
});

export async function createClient(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "clients");
  if (!perms.canCreate) return { error: "Permission denied" };

  const parsed = clientSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    summary: formData.get("summary") || undefined,
    industry: formData.get("industry") || undefined,
    website: formData.get("website") || undefined,
    status: formData.get("status") || "ACTIVE",
  });

  if (!parsed.success) return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };

  const client = await db.client.create({ data: parsed.data });
  await logActivity("created", "client", client.id, user.id, client.name);
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
    industry: formData.get("industry") || undefined,
    website: formData.get("website") || undefined,
    status: formData.get("status") || undefined,
    accountManagerId: formData.get("accountManagerId") || undefined,
  });

  if (!parsed.success) return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };

  await db.client.update({
    where: { id },
    data: {
      ...parsed.data,
      accountManagerId: parsed.data.accountManagerId || null,
    },
  });
  await logActivity("updated", "client", id, user.id, parsed.data.name);
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

  await db.client.delete({ where: { id } });
  await logActivity("deleted", "client", id, user.id, client.name);
  revalidateClient(id);
  return { success: true };
}

// Client Contacts
const contactSchema = z.object({
  name: z.string().min(1, "Name is required"),
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

  await db.clientContact.delete({ where: { id } });
  revalidatePath(`/clients/${contact.clientId}`);
  return { success: true };
}
