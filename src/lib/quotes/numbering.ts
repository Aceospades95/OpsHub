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
  // and the unique-constraint check effective. Fetch every quote
  // number for the year (bounded: one short string column) and take
  // the max parsed suffix in JS — ordering by createdAt would let a
  // back-dated or restored quote shadow the true max and produce a
  // duplicate.
  const yearQuotes = await db.quote.findMany({
    where: { quoteNumber: { contains: `-${year}-` } },
    select: { quoteNumber: true },
  });

  // Anchor on the `-{year}-` segment so a digit run inside a slugified
  // client/project name can never be parsed as the counter.
  const suffixRe = new RegExp(`-${year}-(\\d+)$`);
  let next = 1;
  for (const q of yearQuotes) {
    const m = q.quoteNumber.match(suffixRe);
    if (!m) continue;
    const parsed = parseInt(m[1], 10);
    if (Number.isFinite(parsed) && parsed >= next) next = parsed + 1;
  }

  return `${yearPrefix}${String(next).padStart(4, "0")}`;
}

/**
 * Strip a freeform name down to a quote-number-friendly slug.
 * Keeps it short enough that the full number stays readable.
 */
function slugify(input: string): string {
  // Round-4 QA flagged that the previous "strip non-alphanumerics +
  // slice 12" rule produced "GLOBALTECHSO" from "GlobalTech Solutions"
  // — truncating mid-word and looking like a typo. Switch to
  // first-word-only with a 20-char cap so word boundaries are
  // respected: "GlobalTech Solutions" → "GLOBALTECH",
  // "Acme Corp" → "ACME".
  const words = input
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
  if (words.length === 0) return "Q";
  return words[0].slice(0, 20);
}
