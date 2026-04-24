"use server";

import { requireAuth } from "@/lib/permissions";
import { notify } from "@/lib/notifications";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";

interface RequestAccessParams {
  module: string;
  moduleLabel: string;
  entityType?: string;
  entityId?: string;
  entityLabel?: string;
}

export async function requestAccess(params: RequestAccessParams) {
  const user = await requireAuth();

  const existing = await db.accessRequest.findFirst({
    where: {
      requesterId: user.id,
      module: params.module,
      entityType: params.entityType || null,
      entityId: params.entityId || null,
      status: "PENDING",
    },
  });
  if (existing) return { success: true, alreadyPending: true };

  const request = await db.accessRequest.create({
    data: {
      requesterId: user.id,
      module: params.module,
      entityType: params.entityType || null,
      entityId: params.entityId || null,
      entityLabel: params.entityLabel || null,
    },
  });

  const admins = await db.user.findMany({
    where: { role: "ADMIN", isActive: true },
    select: { id: true },
  });

  if (admins.length > 0) {
    const entityDesc = params.entityLabel
      ? ` — ${params.entityType}: "${params.entityLabel}"`
      : "";
    await notify({
      recipientId: admins.map((a) => a.id),
      type: "system",
      title: `Access request: ${params.moduleLabel}${entityDesc}`,
      body: `${user.name || user.email} is requesting access.`,
      href: `/admin/access-requests`,
      actorId: user.id,
    });
  }

  return { success: true, requestId: request.id };
}

export async function approveAccessRequest(requestId: string) {
  const admin = await requireAuth();
  if (admin.role !== "ADMIN") throw new Error("Unauthorized");

  const request = await db.accessRequest.findUnique({
    where: { id: requestId },
    include: { requester: { select: { id: true, name: true, email: true } } },
  });
  if (!request || request.status !== "PENDING") return { success: false };

  await db.accessRequest.update({
    where: { id: requestId },
    data: { status: "APPROVED", reviewerId: admin.id, reviewedAt: new Date() },
  });

  if (request.entityType && request.entityId) {
    await db.entityPermission.upsert({
      where: {
        userId_entityType_entityId: {
          userId: request.requesterId,
          entityType: request.entityType,
          entityId: request.entityId,
        },
      },
      create: {
        userId: request.requesterId,
        entityType: request.entityType,
        entityId: request.entityId,
        canView: true,
        canComment: true,
      },
      update: {
        canView: true,
        canComment: true,
      },
    });
  } else if (request.module) {
    await db.modulePermission.upsert({
      where: {
        userId_module: {
          userId: request.requesterId,
          module: request.module,
        },
      },
      create: {
        userId: request.requesterId,
        module: request.module,
        canView: true,
        canComment: true,
      },
      update: {
        canView: true,
        canComment: true,
      },
    });
  }

  await notify({
    recipientId: request.requesterId,
    type: "system",
    title: `Access granted: ${request.entityLabel || request.module}`,
    body: `${admin.name || "An admin"} approved your access request.`,
    href: request.entityType && request.entityId
      ? `/${request.module}/${request.entityId}`
      : `/${request.module}`,
  });

  revalidatePath("/admin/access-requests");
  return { success: true };
}

export async function denyAccessRequest(requestId: string) {
  const admin = await requireAuth();
  if (admin.role !== "ADMIN") throw new Error("Unauthorized");

  const request = await db.accessRequest.findUnique({
    where: { id: requestId },
    include: { requester: { select: { id: true, name: true } } },
  });
  if (!request || request.status !== "PENDING") return { success: false };

  await db.accessRequest.update({
    where: { id: requestId },
    data: { status: "DENIED", reviewerId: admin.id, reviewedAt: new Date() },
  });

  await notify({
    recipientId: request.requesterId,
    type: "system",
    title: `Access request denied: ${request.entityLabel || request.module}`,
    body: `${admin.name || "An admin"} denied your access request.`,
  });

  revalidatePath("/admin/access-requests");
  return { success: true };
}
