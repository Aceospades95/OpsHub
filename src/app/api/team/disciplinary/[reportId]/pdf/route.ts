import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { requireAuth } from "@/lib/permissions";
import { getBranding } from "@/lib/branding";
import { renderDisciplinaryPdf } from "@/lib/disciplinary/pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Export a disciplinary report as a PDF for the employee to sign.
 * ADMIN/MANAGER only — same gate as every other disciplinary path.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ reportId: string }> }
) {
  const user = await requireAuth();
  if (user.role !== "ADMIN" && user.role !== "MANAGER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { reportId } = await params;
  const report = await db.disciplinaryReport.findFirst({
    where: { id: reportId, deletedAt: null },
    include: {
      employee: { select: { name: true, jobTitle: true, department: true } },
      issuedBy: { select: { name: true } },
    },
  });
  if (!report) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // The subject never reads their own report through the app — the
  // signed printout handed over by their manager is the employee-facing
  // artifact.
  if (report.employeeId === user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const branding = await getBranding();
  const pdf = await renderDisciplinaryPdf({
    companyName: branding.companyName,
    employeeName: report.employee.name,
    employeeJobTitle: report.employee.jobTitle,
    employeeDepartment: report.employee.department,
    issuedByName: report.issuedBy.name,
    actionType: report.actionType,
    incidentDate: report.incidentDate,
    reportDate: report.createdAt,
    description: report.description,
    actionTaken: report.actionTaken,
    improvementPlan: report.improvementPlan,
    witnesses: report.witnesses,
    followUpDate: report.followUpDate,
    acknowledgedAt: report.acknowledgedAt,
  });

  const safeName = report.employee.name.replace(/[^a-zA-Z0-9]+/g, "-");
  return new NextResponse(pdf as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="disciplinary-report-${safeName}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
