/**
 * Minimal Google Tasks API client — OAuth token plumbing plus the four
 * endpoints the sync uses. Plain fetch, no googleapis dependency: the
 * surface is tiny and the official SDK would add ~10 MB to the build.
 *
 * Reuses the Google SSO OAuth client (GOOGLE_CLIENT_ID / SECRET). The
 * Tasks consent is a SEPARATE grant with its own refresh token stored in
 * GoogleTasksIntegration — connecting Tasks neither requires nor affects
 * Google sign-in.
 */

import { db } from "@/lib/db";
import { log } from "@/lib/log";

const OAUTH_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const TASKS_API = "https://tasks.googleapis.com/tasks/v1";
export const TASKS_SCOPE = "https://www.googleapis.com/auth/tasks";
/** CSRF state cookie set by the connect route, verified by the callback. */
export const STATE_COOKIE = "gt_oauth_state";

export function googleTasksConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function redirectUri(): string {
  const base = (process.env.NEXTAUTH_URL || "http://localhost:3000").replace(/\/$/, "");
  return `${base}/api/integrations/google-tasks/callback`;
}

/** Build the consent-screen URL. `state` must round-trip via cookie. */
export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: TASKS_SCOPE,
    // offline + consent → Google returns a refresh token every time,
    // not just on the very first grant.
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${OAUTH_AUTH_URL}?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
}

export async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google token exchange failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return (await res.json()) as TokenResponse;
}

async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    // invalid_grant = the user revoked access in their Google account —
    // surface a message that tells them to reconnect rather than a 400.
    if (body.includes("invalid_grant")) {
      throw new Error("Google access was revoked — disconnect and reconnect Google Tasks.");
    }
    throw new Error(`Google token refresh failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return (await res.json()) as TokenResponse;
}

/**
 * Return a usable access token for the integration, refreshing and
 * persisting when the cached one is missing or expires within 60s.
 */
export async function getValidAccessToken(integration: {
  id: string;
  refreshToken: string;
  accessToken: string | null;
  accessTokenExpiresAt: Date | null;
}): Promise<string> {
  const now = Date.now();
  if (
    integration.accessToken &&
    integration.accessTokenExpiresAt &&
    integration.accessTokenExpiresAt.getTime() - now > 60_000
  ) {
    return integration.accessToken;
  }
  const refreshed = await refreshAccessToken(integration.refreshToken);
  await db.googleTasksIntegration.update({
    where: { id: integration.id },
    data: {
      accessToken: refreshed.access_token,
      accessTokenExpiresAt: new Date(now + refreshed.expires_in * 1000),
      // Google occasionally rotates the refresh token on refresh.
      ...(refreshed.refresh_token ? { refreshToken: refreshed.refresh_token } : {}),
    },
  });
  return refreshed.access_token;
}

// ─── Tasks API surface ───────────────────────────────────────────────

/** Google's task resource, narrowed to the fields the sync reads. */
export interface GoogleTask {
  id: string;
  title?: string;
  notes?: string;
  /** "needsAction" | "completed" */
  status?: string;
  /** RFC3339 — date-only semantics (time component is always 00:00). */
  due?: string;
  completed?: string;
  updated?: string;
  deleted?: boolean;
  hidden?: boolean;
}

async function tasksFetch<T>(
  accessToken: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(`${TASKS_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`Google Tasks API ${init?.method ?? "GET"} ${path} → ${res.status}: ${body.slice(0, 300)}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  // DELETE returns an empty body.
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function findOrCreateTasklist(
  accessToken: string,
  preferredId: string | null,
  title: string
): Promise<{ id: string }> {
  if (preferredId) {
    try {
      const list = await tasksFetch<{ id: string }>(accessToken, `/users/@me/lists/${preferredId}`);
      if (list?.id) return list;
    } catch (err) {
      // 404 → the user deleted the list in Google; fall through and recreate.
      if ((err as Error & { status?: number }).status !== 404) throw err;
      log.warn("google-tasks", `Tasklist ${preferredId} is gone; recreating`);
    }
  }
  const lists = await tasksFetch<{ items?: { id: string; title: string }[] }>(
    accessToken,
    "/users/@me/lists?maxResults=100"
  );
  const existing = lists.items?.find((l) => l.title === title);
  if (existing) return existing;
  return tasksFetch<{ id: string }>(accessToken, "/users/@me/lists", {
    method: "POST",
    body: JSON.stringify({ title }),
  });
}

/** List tasks updated since `updatedMin` (all tasks when null). Paginates. */
export async function listTasks(
  accessToken: string,
  tasklistId: string,
  updatedMin: Date | null
): Promise<GoogleTask[]> {
  const out: GoogleTask[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      maxResults: "100",
      showCompleted: "true",
      showHidden: "true",
      // Deleted tasks only come back when updatedMin is set — fine: we
      // only need deletions incrementally.
      ...(updatedMin ? { updatedMin: updatedMin.toISOString(), showDeleted: "true" } : {}),
      ...(pageToken ? { pageToken } : {}),
    });
    const page = await tasksFetch<{ items?: GoogleTask[]; nextPageToken?: string }>(
      accessToken,
      `/lists/${tasklistId}/tasks?${params.toString()}`
    );
    out.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return out;
}

export async function patchTask(
  accessToken: string,
  tasklistId: string,
  taskId: string,
  body: Partial<Pick<GoogleTask, "title" | "notes" | "status" | "due" | "completed">>
): Promise<GoogleTask> {
  return tasksFetch<GoogleTask>(accessToken, `/lists/${tasklistId}/tasks/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function insertTask(
  accessToken: string,
  tasklistId: string,
  body: Partial<Pick<GoogleTask, "title" | "notes" | "status" | "due">>
): Promise<GoogleTask> {
  return tasksFetch<GoogleTask>(accessToken, `/lists/${tasklistId}/tasks`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
