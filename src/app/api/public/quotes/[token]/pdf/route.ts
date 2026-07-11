import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { loadQuoteForExport } from "@/lib/quotes/loader";
import { renderQuotePdf } from "@/lib/quotes/pdf";

// react-pdf needs the Node runtime, and each hit renders fresh bytes so
// the client always sees the latest persisted revision.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Token-gated public PDF download — the link "Email quote" sends to the
 * client. No session required: possession of the unguessable token
 * (crypto-random, minted at send time) is the credential, the same
 * trust model as a docs share-link. Only ever a 404 on a bad token so
 * tokens can't be probed apart from quote ids.
 *
 * Also feeds the engagement trail the schema always had columns for:
 * first open stamps `firstViewedAt` + SENT → VIEWED, and every open
 * logs a client-actor "downloaded" QuoteEvent.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!token || token.length < 16) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const quote = await db.quote.findFirst({
    where: { publicToken: token, deletedAt: null },
    select: { id: true, status: true, firstViewedAt: true },
  });
  if (!quote) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const data = await loadQuoteForExport({ token });
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Best-effort engagement tracking — never block the download on it.
  try {
    await db.quote.update({
      where: { id: quote.id },
      data: {
        firstViewedAt: quote.firstViewedAt ?? new Date(),
        ...(quote.status === "SENT" ? { status: "VIEWED" as const } : {}),
      },
    });
    await db.quoteEvent.create({
      data: {
        quoteId: quote.id,
        eventType: "downloaded",
        actorType: "client",
      },
    });
  } catch {
    /* tracking is advisory */
  }

  const pdf = await renderQuotePdf(data);
  return new NextResponse(pdf as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${data.quoteNumber}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
