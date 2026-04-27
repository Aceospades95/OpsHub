import { db } from "@/lib/db";

const PREFIX = "Q";

/**
 * Generate the next quote number for the current year. Format is
 * `Q-YYYY-NNNN` zero-padded to 4 digits — same shape every project I've
 * seen at this scale uses, and it sorts lexicographically.
 *
 * Concurrency: under heavy concurrent creates two sessions could pick the
 * same next-N. We retry on the unique-constraint failure at the call site.
 */
export async function nextQuoteNumber(now: Date = new Date()): Promise<string> {
  const year = now.getUTCFullYear();
  const yearPrefix = `${PREFIX}-${year}-`;

  const last = await db.quote.findFirst({
    where: { quoteNumber: { startsWith: yearPrefix } },
    orderBy: { quoteNumber: "desc" },
    select: { quoteNumber: true },
  });

  let next = 1;
  if (last) {
    const tail = last.quoteNumber.slice(yearPrefix.length);
    const parsed = parseInt(tail, 10);
    if (Number.isFinite(parsed)) next = parsed + 1;
  }
  return `${yearPrefix}${String(next).padStart(4, "0")}`;
}
