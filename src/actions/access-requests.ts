"use server";

import { requireAuth } from "@/lib/permissions";
import { notify } from "@/lib/notifications";
import { db } from "@/lib/db";
import { getPermissionedModules } from "@/lib/modules";
import { revalidatePath } from "next/cache";

interface RequestAccessParams {
  module: string;
  moduleLabel: string;
  entityType?: string;
  entityId?: string;
  entityLabel?: string;
}

// Hard cap on user-controlled string fields that get rendered into
// admin notifications. Defense against an authenticated user passing
// a 100KB entityLabel and DoSing the notification body / admin UI.
const MAX_LABEL_LENGTH = 200;

// Allowlist of entity types the request flow recognizes. Anything else
// is dropped silently (the request still succeeds at the module level
// but doesn't carry the unrecognized entity context). Keeps the
// notification body free of attacker-supplied entityType strings.
const VALID_ENTITY_TYPES = new Set([
  "client",
  "project",
  "contract",
  "tool",
  "certification",
  "supplier",
]);

function clamp(value: string | undefined, max: number): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

export async function requestAccess(params: RequestAccessParams) {
  const user = await requireAuth();

  // Validate `module` against the registry so an attacker can't seed
  // arbitrary strings into AccessRequest.module (which the admin UI
  // renders verbatim). Cast to string[] because getPermissionedModules
  // returns the typed ModuleKey enum and we're comparing against an
  // arbitrary user-supplied string.
  const validModules = getPermissionedModules().map((m) => m.key as string);
  if (!validModules.includes(params.module)) {
    return { error: "Unknown module" } as const;
  }

  // Sanitize the optional fields. entityType must be on the allowlist
  // or it's dropped (turning the request into a module-only ask).
  const entityType =
    params.entityType && VALID_ENTITY_TYPES.has(params.entityType)
      ? params.entityType
      : null;
  const entityId = entityType ? clamp(params.entityId, 64) : null;
  const entityLabel = entityType ? clamp(params.entityLabel, MAX_LABEL_LENGTH) : null;
  const moduleLabel = clamp(params.moduleLabel, MAX_LABEL_LENGTH) || params.module;

  const existing = await db.accessRequest.findFirst({
    where: {
      requesterId: user.id,
      module: params.module,
      entityType,
      entityId,
      status: "PENDING",
    },
  });
  if (existing) return { success: true, alreadyPending: true };

  const request = await db.accessRequest.create({
    data: {
      requesterId: user.id,
      module: params.module,
      entityType,
      entityId,
      entityLabel,
    },
  });

  const admins = await db.user.findMany({
    where: { role: "ADMIN", isActive: true },
    select: { id: true },
  });

  if (admins.length > 0) {
    const entityDesc = entityLabel ? ` — ${entityType}: "${entityLabel}"` : "";
    await notify({
      recipientId: admins.map((a) => a.id),
      type: "system",
      title: `Access request: ${moduleLabel}${entityDesc}`,
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
