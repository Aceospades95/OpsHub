import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { requireAuth } from "@/lib/permissions";
import { exchangeCodeForTokens, STATE_COOKIE } from "@/lib/google-tasks/api";
import { syncGoogleTasksForUser } from "@/lib/google-tasks/sync";
import { absoluteUrl } from "@/lib/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function backToMy(flag: string): NextResponse {
  return NextResponse.redirect(absoluteUrl(`/my?google=${flag}`), { status: 302 });
}

/**
 * OAuth redirect target. Verifies the CSRF state, exchanges the code,
 * stores the tokens on the user's GoogleTasksIntegration row, and runs
 * a first sync so the inbox isn't empty on return.
 */
export async function GET(req: Request) {
  const user = await requireAuth();
  const url = new URL(req.url);

  const cookieState = cookies().get(STATE_COOKIE)?.value;
  cookies().delete(STATE_COOKIE);

  if (url.searchParams.get("error")) {
    // User clicked "Cancel" on the consent screen.
    return backToMy("denied");
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || !cookieState || state !== cookieState) {
    return backToMy("error");
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.refresh_token) {
      // Shouldn't happen with prompt=consent, but don't store a
      // connection that can't survive its first hour.
      log.error("google-tasks", "Token exchange returned no refresh_token");
      return backToMy("error");
    }

    await db.googleTasksIntegration.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        refreshToken: tokens.refresh_token,
        accessToken: tokens.access_token,
        accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      },
      update: {
        refreshToken: tokens.refresh_token,
        accessToken: tokens.access_token,
        accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        lastSyncStatus: null,
        lastSyncError: null,
      },
    });

    // First sync inline so the user lands on a populated inbox. Failures
    // here are non-fatal — the job retries on its next tick.
    await syncGoogleTasksForUser(user.id).catch((err) =>
      log.error("google-tasks", "Initial sync failed", err)
    );

    return backToMy("connected");
  } catch (err) {
    log.error("google-tasks", "OAuth callback failed", err);
    return backToMy("error");
  }
}
