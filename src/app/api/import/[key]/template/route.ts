/**
 * Template CSV download route: GET /api/import/{key}/template
 *
 * Returns a sample CSV for the named importer with headers and one
 * example row. Admin-only.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getImporter, generateSampleCsv } from "@/lib/importers";

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

  const csv = await generateSampleCsv(importer);
  const filename = `${key}-template.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
