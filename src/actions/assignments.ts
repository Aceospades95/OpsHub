"use server";

import { db } from "@/lib/db";
import { requireAuth } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { revalidatePath } from "next/cache";
import { z } from "zod";

function requireAdminOrManager(role: string) {
  if (role !== "ADMIN" && role !== "MANAGER") throw new Error("Admin or Manager access required");
}

const assignmentSchema = z.object({
  employeeId: z.string().min(1, "Employee is required"),
  projectId: z.string().optional(),
  clientId: z.string().optional(),
  serviceOfferingId: z.string().optional(),
  function: z.string().optional(),
  role: z.string().optional(),
  allocationFte: z.number().min(0).max(2),
  status: z.enum(["ACTIVE", "PLANNED", "COMPLETED", "ON_HOLD"]).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  notes: z.string().optional(),
});

export async function createAssignment(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  requireAdminOrManager(user.role);

  const parsed = assignmentSchema.safeParse({
    employeeId: formData.get("employeeId"),
    projectId: formData.get("projectId") || undefined,
    clientId: formData.get("clientId") || undefined,
    serviceOfferingId: formData.get("serviceOfferingId") || undefined,
    function: formData.get("function") || undefined,
    role: formData.get("role") || undefined,
    allocationFte: parseFloat(formData.get("allocationFte") as string) || 0,
    status: (formData.get("status") as string) || "ACTIVE",
    startDate: formData.get("startDate") || undefined,
    endDate: formData.get("endDate") || undefined,
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };

  const assignment = await db.assignment.create({
    data: {
      ...parsed.data,
      startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : undefined,
      endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : undefined,
    },
  });

  await logActivity("created", "assignment", assignment.id, user.id, `Assignment for employee ${parsed.data.employeeId}`);
  revalidatePath("/team");
  return { success: true };
}

export async function updateAssignment(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  requireAdminOrManager(user.role);

  const id = formData.get("id") as string;

  const parsed = assignmentSchema.safeParse({
    employeeId: formData.get("employeeId"),
    projectId: formData.get("projectId") || undefined,
    clientId: formData.get("clientId") || undefined,
    serviceOfferingId: formData.get("serviceOfferingId") || undefined,
    function: formData.get("function") || undefined,
    role: formData.get("role") || undefined,
    allocationFte: parseFloat(formData.get("allocationFte") as string) || 0,
    status: (formData.get("status") as string) || "ACTIVE",
    startDate: formData.get("startDate") || undefined,
    endDate: formData.get("endDate") || undefined,
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };

  await db.assignment.update({
    where: { id },
    data: {
      ...parsed.data,
      startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : null,
      endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : null,
    },
  });

  await logActivity("updated", "assignment", id, user.id);
  revalidatePath("/team");
  return { success: true };
}

export async function deleteAssignment(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  requireAdminOrManager(user.role);

  const id = formData.get("id") as string;
  await db.assignment.delete({ where: { id } });
  await logActivity("deleted", "assignment", id, user.id);
  revalidatePath("/team");
  return { success: true };
}

// Service Offering CRUD
const serviceOfferingSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
});

export async function createServiceOffering(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  requireAdminOrManager(user.role);

  const parsed = serviceOfferingSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
  });

  if (!parsed.success) return { error: "Invalid input" };

  const existing = await db.serviceOffering.findUnique({ where: { name: parsed.data.name } });
  if (existing) return { error: "Service offering already exists" };

  const so = await db.serviceOffering.create({ data: parsed.data });
  await logActivity("created", "serviceOffering", so.id, user.id, so.name);
  revalidatePath("/team");
  return { success: true };
}
