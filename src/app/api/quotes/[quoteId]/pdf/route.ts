import { NextResponse } from "next/server";

import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { loadQuoteForExport } from "@/lib/quotes/loader";
import { renderQuotePdf } from "@/lib/quotes/pdf";

// react-pdf needs the Node runtime — Edge doesn't have the Buffer/stream
// APIs it depends on. We also force-dynamic so each request renders a
// fresh PDF that reflects the latest persisted line items.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ quoteId: string }> }
) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "quotes");
  if (!perms.canView) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { quoteId } = await params;
  const data = await loadQuoteForExport({ id: quoteId });
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const pdf = await renderQuotePdf(data);
  return new NextResponse(pdf as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${data.quoteNumber}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
