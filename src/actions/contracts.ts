"use server";

import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const contractSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  status: z.enum(["DRAFT", "UNDER_REVIEW", "ACTIVE", "EXPIRING_SOON", "EXPIRED", "TERMINATED", "RENEWED"]).optional(),
  contractNumber: z.string().optional(),
  contractType: z.enum(["MSA", "SOW", "NDA", "Amendment", "Other"]).optional().nullable(),
  value: z.coerce.number().optional().nullable(),
  currency: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  renewalDate: z.string().optional(),
  noticePeriodDays: z.coerce.number().int().optional().nullable(),
  autoRenew: z.boolean().optional(),
  summary: z.string().optional(),
  externalDocumentUrl: z.string().optional(),
  documentSourceType: z.string().optional(),
  documentSourceLabel: z.string().optional(),
  parentContractId: z.string().optional(),
  clientId: z.string().min(1, "Client is required"),
  projectId: z.string().optional(),
});

export async function createContract(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "contracts");
  if (!perms.canCreate) return { error: "Permission denied" };

  const g = (k: string) => { const v = formData.get(k); return v === "" || v === null ? undefined : String(v); };

  const parsed = contractSchema.safeParse({
    title: g("title"),
    description: g("description"),
    status: g("status"),
    contractNumber: g("contractNumber"),
    contractType: g("contractType") || null,
    value: g("value") ? Number(g("value")) : null,
    currency: g("currency"),
    startDate: g("startDate"),
    endDate: g("endDate"),
    renewalDate: g("renewalDate"),
    noticePeriodDays: g("noticePeriodDays") ? Number(g("noticePeriodDays")) : null,
    autoRenew: formData.get("autoRenew") === "true",
    summary: g("summary"),
    externalDocumentUrl: g("externalDocumentUrl"),
    documentSourceType: g("documentSourceType"),
    documentSourceLabel: g("documentSourceLabel"),
    parentContractId: g("parentContractId"),
    clientId: g("clientId"),
    projectId: g("projectId"),
  });
  if (!parsed.success) return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };

  const contract = await db.contract.create({
    data: {
      ...parsed.data,
      contractType: parsed.data.contractType as "MSA" | "SOW" | "NDA" | "Amendment" | "Other" | undefined ?? undefined,
      startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : undefined,
      endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : undefined,
      renewalDate: parsed.data.renewalDate ? new Date(parsed.data.renewalDate) : undefined,
      parentContractId: parsed.data.parentContractId || undefined,
      projectId: parsed.data.projectId || undefined,
    },
  });

  await logActivity("created", "contract", contract.id, user.id, contract.title);
  revalidatePath("/contracts");
  // Contracts show on client and project detail pages, so those need to refresh too.
  if (contract.clientId) revalidatePath(`/clients/${contract.clientId}`);
  if (contract.projectId) revalidatePath(`/projects/${contract.projectId}`);
  return { success: true };
}

export async function updateContract(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "contracts");
  if (!perms.canEdit) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  const g = (k: string) => { const v = formData.get(k); return v === "" || v === null ? undefined : String(v); };

  const parsed = contractSchema.safeParse({
    title: g("title"),
    description: g("description"),
    status: g("status"),
    contractNumber: g("contractNumber"),
    contractType: g("contractType") || null,
    value: g("value") ? Number(g("value")) : null,
    currency: g("currency"),
    startDate: g("startDate"),
    endDate: g("endDate"),
    renewalDate: g("renewalDate"),
    noticePeriodDays: g("noticePeriodDays") ? Number(g("noticePeriodDays")) : null,
    autoRenew: formData.get("autoRenew") === "true",
    summary: g("summary"),
    externalDocumentUrl: g("externalDocumentUrl"),
    documentSourceType: g("documentSourceType"),
    documentSourceLabel: g("documentSourceLabel"),
    parentContractId: g("parentContractId"),
    clientId: g("clientId"),
    projectId: g("projectId"),
  });
  if (!parsed.success) return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };

  // Look up previous clientId/projectId so we can revalidate the old pages too
  // if those links changed.
  const previous = await db.contract.findUnique({
    where: { id },
    select: { clientId: true, projectId: true },
  });

  await db.contract.update({
    where: { id },
    data: {
      ...parsed.data,
      contractType: parsed.data.contractType as "MSA" | "SOW" | "NDA" | "Amendment" | "Other" | undefined ?? undefined,
      startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : null,
      endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : null,
      renewalDate: parsed.data.renewalDate ? new Date(parsed.data.renewalDate) : null,
      parentContractId: parsed.data.parentContractId || null,
      projectId: parsed.data.projectId || null,
    },
  });

  await logActivity("updated", "contract", id, user.id, parsed.data.title);
  revalidatePath(`/contracts/${id}`);
  revalidatePath("/contracts");
  // Revalidate both old and new client/project pages so the contract list
  // on those pages stays in sync.
  if (parsed.data.clientId) revalidatePath(`/clients/${parsed.data.clientId}`);
  if (previous?.clientId && previous.clientId !== parsed.data.clientId) {
    revalidatePath(`/clients/${previous.clientId}`);
  }
  if (parsed.data.projectId) revalidatePath(`/projects/${parsed.data.projectId}`);
  if (previous?.projectId && previous.projectId !== parsed.data.projectId) {
    revalidatePath(`/projects/${previous.projectId}`);
  }
  return { success: true };
}

export async function deleteContract(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "contracts");
  if (!perms.canDelete) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  const contract = await db.contract.findUnique({ where: { id } });
  if (!contract) return { error: "Not found" };

  await db.contract.delete({ where: { id } });
  await logActivity("deleted", "contract", id, user.id, contract.title);
  revalidatePath("/contracts");
  // Revalidate the client/project pages where this contract used to appear.
  if (contract.clientId) revalidatePath(`/clients/${contract.clientId}`);
  if (contract.projectId) revalidatePath(`/projects/${contract.projectId}`);
  return { success: true };
}

// Contract Terms
const termSchema = z.object({
  type: z.enum(["SLA", "OBLIGATION", "DEADLINE", "DELIVERABLE", "ESCALATION", "RENEWAL", "BILLING", "PENALTY", "OTHER"]).optional(),
  title: z.string().min(1, "Title is required"),
  description: z.string().min(1, "Description is required"),
  priority: z.enum(["HIGH", "MEDIUM", "LOW"]).optional(),
  dueDate: z.string().optional(),
  contractId: z.string(),
});

export async function createContractTerm(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "contracts");
  if (!perms.canEdit) return { error: "Permission denied" };

  const parsed = termSchema.safeParse({
    type: formData.get("type") || "OTHER",
    title: formData.get("title"),
    description: formData.get("description"),
    priority: formData.get("priority") || "MEDIUM",
    dueDate: formData.get("dueDate") || undefined,
    contractId: formData.get("contractId"),
  });

  if (!parsed.success) return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };

  await db.contractTerm.create({
    data: {
      ...parsed.data,
      dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : undefined,
    },
  });

  revalidatePath(`/contracts/${parsed.data.contractId}`);
  return { success: true };
}

export async function deleteContractTerm(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "contracts");
  if (!perms.canDelete) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  const term = await db.contractTerm.findUnique({ where: { id } });
  if (!term) return { error: "Not found" };

  await db.contractTerm.delete({ where: { id } });
  revalidatePath(`/contracts/${term.contractId}`);
  return { success: true };
}
