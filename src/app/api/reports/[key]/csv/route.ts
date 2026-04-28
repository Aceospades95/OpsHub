/**
 * Report CSV download route: GET /api/reports/{key}/csv
 *
 * Runs the named report and streams the result as a CSV attachment.
 * Admin-only — this is a full data export, so we gate it the same way
 * as the other admin tools.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { runReport, renderCsv } from "@/lib/reports";
import { runCustomReportFromRow } from "@/lib/reports/custom/runtime";
import { db } from "@/lib/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const { key: rawKey } = await params;
  // Browsers encode the `:` in `custom:{id}` as `%3A` when used in a
  // path segment — decode so the prefix check works either way.
  const key = decodeURIComponent(rawKey);

  try {
    let output: Awaited<ReturnType<typeof runReport>>["output"];
    let name: string;
    if (key.startsWith("custom:")) {
      const id = key.slice("custom:".length);
      const row = await db.customReport.findUnique({ where: { id } });
      if (!row) {
        return new NextResponse(`Custom report ${id} not found`, { status: 404 });
      }
      output = await runCustomReportFromRow(row);
      name = row.name;
    } else {
      const result = await runReport(key, {
        triggeredAt: new Date(),
        triggeredBy: session.user.id,
      });
      output = result.output;
      name = result.name;
    }

    const csv = renderCsv(output);
    // Turn the display name into a safe filename base
    const stem = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48);
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `${stem || key}-${stamp}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return new NextResponse(
      err instanceof Error ? err.message : "Failed to run report",
      { status: 500 }
    );
  }
}
