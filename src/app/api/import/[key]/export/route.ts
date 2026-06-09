/**
 * Full export download route: GET /api/import/{key}/export
 *
 * Returns every row currently in the DB as a CSV in the same column
 * shape the importer's `commit()` expects. Admins use this for the
 * round-trip workflow: download → edit in Excel → re-upload to update
 * existing records.
 *
 * Distinct from the /template endpoint, which returns a blank CSV
 * with only sample rows. Templates are for first-time imports;
 * exports are for editing existing data.
 *
 * Only enabled for importers that opt in via `exportRows()`. Importers
 * that describe events (assignments, milestones) or many-to-many
 * link rows (project-tools, supplier-projects) intentionally skip
 * `exportRows()` because re-uploading event-style data would create
 * duplicates rather than update.
 *
 * Admin-only — full data dump, gated like the other export endpoints.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getImporter, generateExportCsv } from "@/lib/importers";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  // The JWT caches the role from sign-in time (see requireAuth in
  // @/lib/permissions) — a demoted admin would keep export access until
  // token expiry. Re-read the fresh role before gating the export.
  const freshUser = await db.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  });
  if (freshUser?.role !== "ADMIN") {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const { key } = await params;
  const importer = getImporter(key);
  if (!importer) {
    return new NextResponse("Importer not found", { status: 404 });
  }

  const csv = await generateExportCsv(importer);
  if (csv === null) {
    return new NextResponse(
      `Importer "${key}" doesn't support full export. Use the template download instead.`,
      { status: 404 }
    );
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `${key}-export-${stamp}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
