/**
 * Activity log CSV export: GET /api/admin/activity/csv
 *
 * Streams the full filtered result set (no pagination) so admins can pull a
 * complete audit trail. Filter params mirror the /admin/activity page:
 * actor, entityType, projectId, clientId, from, to.
 *
 * Admin-only, same gate as the other export routes.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseCalendarDateString } from "@/lib/dates";

/**
 * Hard ceiling on a single CSV export. Tight filters return well under
 * this; loose filters (e.g. "all activity, no date range") would
 * otherwise pull arbitrary numbers of rows into one HTTP response and
 * could OOM the Next.js worker. When the cap kicks in, the response
 * still streams the most recent MAX_EXPORT_ROWS and a warning header
 * tells the caller the export was truncated so they can re-run with a
 * narrower filter.
 */
const MAX_EXPORT_ROWS = 100_000;

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });
  // The JWT caches the role from sign-in time (see requireAuth in
  // @/lib/permissions) — a demoted admin would keep export access until
  // token expiry. Re-read the fresh role before gating the export.
  const freshUser = await db.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  });
  if (freshUser?.role !== "ADMIN") return new NextResponse("Forbidden", { status: 403 });

  const url = new URL(request.url);
  const where = buildWhere(url.searchParams);
  if (!where) {
    return new NextResponse("Invalid 'from' or 'to' date; use YYYY-MM-DD", {
      status: 400,
    });
  }

  const rows = await db.activityLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: MAX_EXPORT_ROWS,
    include: {
      user: { select: { name: true, email: true } },
      project: { select: { name: true } },
      client: { select: { name: true } },
    },
  });
  const truncated = rows.length === MAX_EXPORT_ROWS;

  const header = [
    "timestamp",
    "actor_name",
    "actor_email",
    "action",
    "entity_type",
    "entity_id",
    "project",
    "client",
    "details",
  ];

  const lines: string[] = [header.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.createdAt.toISOString(),
        row.user?.name ?? "",
        row.user?.email ?? "",
        row.action,
        row.entityType,
        row.entityId,
        row.project?.name ?? "",
        row.client?.name ?? "",
        row.details ?? "",
      ]
        .map(csvEscape)
        .join(",")
    );
  }

  const csv = lines.join("\n");
  const stamp = new Date().toISOString().slice(0, 10);
  const headers: Record<string, string> = {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="activity-log-${stamp}.csv"`,
    "Cache-Control": "no-store",
  };
  if (truncated) {
    headers["X-Export-Truncated"] = `true; limit=${MAX_EXPORT_ROWS}`;
  }
  return new NextResponse(csv, { status: 200, headers });
}

// Returns null when `from` / `to` are present but not valid YYYY-MM-DD
// dates — `new Date("garbage")` is NaN and makes Prisma throw a 500.
function buildWhere(qp: URLSearchParams): Record<string, unknown> | null {
  const where: Record<string, unknown> = {};
  const actor = qp.get("actor");
  const entityType = qp.get("entityType");
  const projectId = qp.get("projectId");
  const clientId = qp.get("clientId");
  const from = qp.get("from");
  const to = qp.get("to");

  if (actor) where.userId = actor;
  if (entityType) where.entityType = entityType;
  if (projectId) where.projectId = projectId;
  if (clientId) where.clientId = clientId;
  if (from || to) {
    const range: Record<string, Date> = {};
    if (from) {
      const start = parseCalendarDateString(from);
      if (!start) return null;
      range.gte = start;
    }
    if (to) {
      const end = parseCalendarDateString(to);
      if (!end) return null;
      end.setUTCHours(23, 59, 59, 999);
      range.lte = end;
    }
    where.createdAt = range;
  }
  return where;
}

function csvEscape(value: string): string {
  // Spreadsheet-formula injection guard: a leading =, +, -, @, tab, or
  // CR makes Excel/Sheets evaluate the cell as a formula on open.
  // Prefix a single quote to neutralize — except pure numbers (e.g.
  // "-12.5"), which are safe and must stay numeric for spreadsheets.
  if (/^[=+\-@\t\r]/.test(value) && !/^-?\d+(\.\d+)?$/.test(value)) {
    value = `'${value}`;
  }
  // Quote if the field contains comma, quote, newline, or carriage return.
  // Inside quoted fields, escape embedded quotes by doubling them.
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
