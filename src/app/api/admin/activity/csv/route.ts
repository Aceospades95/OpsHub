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

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });
  if (session.user.role !== "ADMIN") return new NextResponse("Forbidden", { status: 403 });

  const url = new URL(request.url);
  const where = buildWhere(url.searchParams);

  const rows = await db.activityLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { name: true, email: true } },
      project: { select: { name: true } },
      client: { select: { name: true } },
    },
  });

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
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="activity-log-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

function buildWhere(qp: URLSearchParams) {
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
    if (from) range.gte = new Date(from);
    if (to) {
      const end = new Date(to);
      end.setUTCHours(23, 59, 59, 999);
      range.lte = end;
    }
    where.createdAt = range;
  }
  return where;
}

function csvEscape(value: string): string {
  // Quote if the field contains comma, quote, newline, or carriage return.
  // Inside quoted fields, escape embedded quotes by doubling them.
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
