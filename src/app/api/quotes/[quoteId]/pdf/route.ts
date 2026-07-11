import { NextResponse } from "next/server";

import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { canAccessQuote } from "@/lib/quotes/access";
import { loadQuoteForExport } from "@/lib/quotes/loader";
import { renderQuotePdf } from "@/lib/quotes/pdf";
import { db } from "@/lib/db";

// react-pdf needs the Node runtime — Edge doesn't have the Buffer/stream
// APIs it depends on. We also force-dynamic so each request renders a
// fresh PDF that reflects the latest persisted line items.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ quoteId: string }> }
) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "quotes");
  if (!perms.canView) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { quoteId } = await params;
  // Per-quote gate on top of the module gate: non-org-wide roles can only
  // export their own quotes. 404 (not 403) so ids can't be probed.
  const quote = await db.quote.findFirst({
    where: { id: quoteId, deletedAt: null },
    select: { createdById: true, assignedToId: true },
  });
  if (!quote || !canAccessQuote(user, quote)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const data = await loadQuoteForExport({ id: quoteId });
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const pdf = await renderQuotePdf(data);
  // ?inline=1 renders in the browser tab (the editor's Preview/Print
  // buttons); default stays a download.
  const inline = new URL(req.url).searchParams.get("inline") === "1";
  return new NextResponse(pdf as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${data.quoteNumber}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
