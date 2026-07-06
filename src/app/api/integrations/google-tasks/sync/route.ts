import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/permissions";
import { syncGoogleTasksForUser } from "@/lib/google-tasks/sync";
import { absoluteUrl } from "@/lib/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Manual "Sync now" from /my. Full-page form post → run the sync for the
 * signed-in user → bounce back. 303 so the browser re-GETs /my.
 */
export async function POST() {
  const user = await requireAuth();
  await syncGoogleTasksForUser(user.id);
  return NextResponse.redirect(absoluteUrl("/my"), { status: 303 });
}
