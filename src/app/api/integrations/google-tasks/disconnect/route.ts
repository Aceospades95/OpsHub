import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { requireAuth } from "@/lib/permissions";
import { absoluteUrl } from "@/lib/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Disconnect Google Tasks for the signed-in user. Drops the integration
 * row (tokens included). Tasks that were synced stay in OpsHub — they're
 * real tasks now — they just stop syncing.
 */
export async function POST() {
  const user = await requireAuth();
  await db.googleTasksIntegration.deleteMany({ where: { userId: user.id } });
  return NextResponse.redirect(absoluteUrl("/my"), { status: 303 });
}
