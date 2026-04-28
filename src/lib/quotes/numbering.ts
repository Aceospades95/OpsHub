import { db } from "@/lib/db";

/**
 * Generate the next quote number for the year.
 *
 * Format:
 *   {CLIENT}-{YYYY}-{NNNN}              when only a client is set
 *   {CLIENT}-{PROJECT}-{YYYY}-{NNNN}    when a project is set too
 *
 * The slug component is derived from the client (and project) name —
 * stripped to alphanumerics, uppercased, capped at 12 chars so the
 * full number stays scannable. The year + zero-padded counter at the
 * tail are unique across the whole org per year, so concurrent
 * creates are detected by the unique constraint on `quoteNumber`.
 *
 * Examples:
 *   "Acme Corp" → "ACME-2026-0001"
 *   "Acme Corp" + "Marketing Site" → "ACME-MARKETIN-2026-0001"
 *
 * Concurrency: under heavy concurrent creates two sessions could pick
 * the same N. We retry on the unique-constraint failure at the call
 * site (see createQuote in src/actions/quotes.ts).
 */
export async function nextQuoteNumber(
  clientName: string,
  projectName: string | null = null,
  now: Date = new Date()
): Promise<string> {
  const year = now.getUTCFullYear();
  const clientSlug = slugify(clientName);
  const projectSlug = projectName ? slugify(projectName) : null;

  const yearPrefix = projectSlug
    ? `${clientSlug}-${projectSlug}-${year}-`
    : `${clientSlug}-${year}-`;

  // Counter is global per year (across all clients / projects) so a
  // single "highest seen this year" lookup keeps the suffix monotonic
  // and the unique-constraint check effective. We pull the latest
  // quote from the current year regardless of prefix and increment
  // its trailing N.
  const lastForYear = await db.quote.findFirst({
    where: { quoteNumber: { contains: `-${year}-` } },
    orderBy: { createdAt: "desc" },
    select: { quoteNumber: true },
  });

  let next = 1;
  if (lastForYear) {
    const m = lastForYear.quoteNumber.match(/-(\d{4,})$/);
    if (m) {
      const parsed = parseInt(m[1], 10);
      if (Number.isFinite(parsed)) next = parsed + 1;
    }
  }

  return `${yearPrefix}${String(next).padStart(4, "0")}`;
}

/**
 * Strip a freeform name down to a quote-number-friendly slug.
 * Keeps it short enough that the full number stays readable.
 */
function slugify(input: string): string {
  const cleaned = input
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, 12);
  // Fall back to a placeholder if the input has no usable characters
  // (e.g. a name made entirely of emoji or punctuation).
  return cleaned || "Q";
}
