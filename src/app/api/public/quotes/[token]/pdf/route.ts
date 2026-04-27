import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { loadQuoteForExport } from "@/lib/quotes/loader";
import { renderQuotePdf } from "@/lib/quotes/pdf";

// Public token-gated quote PDF. No auth — the cryptographic token is the
// authorization. Logs a "downloaded" event so the owner sees recipient
// activity in the quote's audit log.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const data = await loadQuoteForExport({ token });
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Audit log — best-effort, never block the download on a failed write.
  try {
    const quote = await db.quote.findUnique({
      where: { publicToken: token },
      select: { id: true },
    });
    if (quote) {
      await db.quoteEvent.create({
        data: {
          quoteId: quote.id,
          eventType: "downloaded",
          actorType: "client",
        },
      });
    }
  } catch {
    // Swallow — the recipient still gets their PDF.
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
