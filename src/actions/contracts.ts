"use server";

import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { assertManageEntity } from "@/lib/entity-authz";
import { logActivity } from "@/lib/activity";
import { revalidatePath } from "next/cache";
import { revalidateContract } from "@/lib/revalidate-entity";
import { z } from "zod";
import { isValidCalendarRange } from "@/lib/dates";

const contractSchema = z
  .object({
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
  })
  .refine((d) => isValidCalendarRange(d.startDate, d.endDate), {
    message: "End date must be on or after start date",
    path: ["endDate"],
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

  await logActivity("created", "contract", contract.id, user.id, contract.title, {
    clientId: contract.clientId,
    projectId: contract.projectId,
  });
  revalidateContract(contract.id, {
    clientId: contract.clientId,
    projectId: contract.projectId,
  });
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
  // if those links changed. Doubles as the existence + soft-delete guard:
  // a missing id would throw P2025 (→ 500) and a soft-deleted contract
  // must not be editable from a stale form.
  const previous = await db.contract.findFirst({
    where: { id, deletedAt: null },
    select: { clientId: true, projectId: true },
  });
  if (!previous) return { error: "Not found" };

  // Entity-scope write gate — module canEdit alone would let any
  // CONTRIBUTOR mutate arbitrary contracts by id.
  const denied = await assertManageEntity(user.id, user.role, "contract", id);
  if (denied) return { error: denied.error };

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

  await logActivity("updated", "contract", id, user.id, parsed.data.title, {
    clientId: parsed.data.clientId ?? previous?.clientId ?? null,
    projectId: parsed.data.projectId ?? previous?.projectId ?? null,
  });
  revalidateContract(id, {
    clientId: parsed.data.clientId ?? null,
    previousClientId: previous?.clientId ?? null,
    projectId: parsed.data.projectId ?? null,
    previousProjectId: previous?.projectId ?? null,
  });
  return { success: true };
}

export async function deleteContract(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "contracts");
  if (!perms.canDelete) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  const contract = await db.contract.findUnique({ where: { id } });
  if (!contract) return { error: "Not found" };
  if (contract.deletedAt) {
    return { error: "Already in the recovery bin" };
  }

  const denied = await assertManageEntity(user.id, user.role, "contract", id);
  if (denied) return { error: denied.error };

  await db.contract.update({ where: { id }, data: { deletedAt: new Date() } });
  await logActivity("soft-deleted", "contract", id, user.id, contract.title, {
    clientId: contract.clientId,
    projectId: contract.projectId,
  });
  revalidateContract(id, {
    clientId: contract.clientId,
    projectId: contract.projectId,
    deleted: true,
  });
  return { success: true };
}

/**
 * Attach an existing contract to a project (sets Contract.projectId).
 * Invoked from the project detail page's Contracts card. The contract
 * must belong to the same client as the project — a contract is owned
 * by a client, and the project's client is fixed, so cross-client
 * linking would be a data-integrity bug. If the contract is currently
 * on another project this moves it (both project pages revalidate).
 *
 * Gated on BOTH the contract and the project: the actor must be able to
 * manage the contract (whose FK changes) and the project it's joining.
 */
export async function linkContractToProject(
  contractId: string,
  projectId: string
): Promise<{ success: true } | { error: string }> {
  const user = await requireAuth();
  const contractPerms = await resolveModulePerms(user.id, user.role, "contracts");
  if (!contractPerms.canEdit) return { error: "Permission denied" };
  const projectPerms = await resolveModulePerms(user.id, user.role, "projects");
  if (!projectPerms.canEdit) return { error: "Permission denied" };

  const contract = await db.contract.findFirst({
    where: { id: contractId, deletedAt: null },
    select: { id: true, title: true, clientId: true, projectId: true },
  });
  if (!contract) return { error: "Contract not found" };

  const project = await db.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { id: true, clientId: true },
  });
  if (!project) return { error: "Project not found" };

  if (contract.clientId !== project.clientId) {
    return { error: "Contract belongs to a different client than this project" };
  }
  if (contract.projectId === projectId) {
    return { error: "Contract is already linked to this project" };
  }

  const contractGate = await assertManageEntity(user.id, user.role, "contract", contractId);
  if (contractGate) return { error: contractGate.error };
  const projectGate = await assertManageEntity(user.id, user.role, "project", projectId);
  if (projectGate) return { error: projectGate.error };

  const previousProjectId = contract.projectId;
  await db.contract.update({ where: { id: contractId }, data: { projectId } });
  await logActivity("linked", "contract", contractId, user.id, contract.title, {
    clientId: contract.clientId,
    projectId,
  });

  revalidateContract(contractId, {
    clientId: contract.clientId,
    projectId,
    previousProjectId,
  });
  return { success: true };
}

/** Detach a contract from its project (clears Contract.projectId). The
 * contract itself is untouched and remains under its client. */
export async function unlinkContractFromProject(
  contractId: string
): Promise<{ success: true } | { error: string }> {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "contracts");
  if (!perms.canEdit) return { error: "Permission denied" };

  const contract = await db.contract.findFirst({
    where: { id: contractId, deletedAt: null },
    select: { id: true, title: true, clientId: true, projectId: true },
  });
  if (!contract) return { error: "Contract not found" };
  if (!contract.projectId) return { error: "Contract is not linked to a project" };

  const gate = await assertManageEntity(user.id, user.role, "contract", contractId);
  if (gate) return { error: gate.error };

  const previousProjectId = contract.projectId;
  await db.contract.update({ where: { id: contractId }, data: { projectId: null } });
  await logActivity("unlinked", "contract", contractId, user.id, contract.title, {
    clientId: contract.clientId,
    projectId: previousProjectId,
  });

  revalidateContract(contractId, {
    clientId: contract.clientId,
    previousProjectId,
  });
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

  // Terms hang off a contract — verify the parent exists (and isn't
  // soft-deleted), then gate on it.
  const parent = await db.contract.findFirst({
    where: { id: parsed.data.contractId, deletedAt: null },
    select: { id: true },
  });
  if (!parent) return { error: "Not found" };

  const denied = await assertManageEntity(user.id, user.role, "contract", parsed.data.contractId);
  if (denied) return { error: denied.error };

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

  const denied = await assertManageEntity(user.id, user.role, "contract", term.contractId);
  if (denied) return { error: denied.error };

  await db.contractTerm.delete({ where: { id } });
  revalidatePath(`/contracts/${term.contractId}`);
  return { success: true };
}
