"use server";

import { requireAuth } from "@/lib/permissions";
import { notify } from "@/lib/notifications";
import { db } from "@/lib/db";

export async function requestModuleAccess(module: string, moduleLabel: string) {
  const user = await requireAuth();

  const admins = await db.user.findMany({
    where: { role: "ADMIN", isActive: true },
    select: { id: true },
  });

  if (admins.length === 0) return { success: true };

  await notify({
    recipientId: admins.map((a) => a.id),
    type: "system",
    title: `Access request: ${moduleLabel}`,
    body: `${user.name || user.email} is requesting access to the ${moduleLabel} module.`,
    href: `/team/${user.id}`,
    actorId: user.id,
  });

  return { success: true };
}
