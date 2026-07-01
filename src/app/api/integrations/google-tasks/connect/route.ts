import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "crypto";

import { requireAuth } from "@/lib/permissions";
import { buildAuthUrl, googleTasksConfigured, STATE_COOKIE } from "@/lib/google-tasks/api";
import { absoluteUrl } from "@/lib/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Starts the Google Tasks OAuth consent flow for the signed-in user.
 * GET so it can be a plain link from /my.
 */
export async function GET() {
  await requireAuth();

  if (!googleTasksConfigured()) {
    return NextResponse.redirect(
      absoluteUrl("/my?google=unconfigured"),
      { status: 302 }
    );
  }

  const state = randomBytes(24).toString("hex");
  cookies().set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/api/integrations/google-tasks",
  });

  return NextResponse.redirect(buildAuthUrl(state), { status: 302 });
}
