/**
 * URL-friendly slug generation.
 *
 * Round-8 QA flagged that UI-created clients / projects / intranet
 * resources got cuid URLs (`/clients/cmow4ftfg…`) while seeded
 * fixtures used readable slugs (`/clients/client-acme`). The
 * inconsistency was confusing on its face and made bookmarks
 * unfriendly.
 *
 * The fix: a `slug` column on each affected model that's filled at
 * create time. Detail pages still resolve by id as a fallback so
 * existing cuid bookmarks keep working — see `findBySlugOrId`.
 *
 * Slug rules:
 *   - lower-case
 *   - replace any run of non-alphanumeric characters with a single `-`
 *   - trim leading + trailing dashes
 *   - cap at 60 characters so URLs stay scanable
 *   - fall back to a short random token if the input has no
 *     usable characters (e.g. all emoji)
 */
export function slugify(input: string): string {
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/^-+|-+$/g, "");
  if (cleaned) return cleaned;
  // Last resort — preserves SOMETHING distinguishable in the URL when
  // the input is unrenderable (Chinese-only, emoji, punctuation, …).
  // 6 random chars is enough to avoid practical collisions and the
  // outer ensureUniqueSlug() loop will retry if it does collide.
  return Math.random().toString(36).slice(2, 8);
}

/**
 * Append `-2`, `-3`, … to the base slug until `isTaken(candidate)`
 * returns false. Caller passes a function that hits the DB once per
 * candidate; in practice the first try wins for any reasonable
 * naming so we expect 1 round-trip.
 *
 * The 50-attempt ceiling is a safety net — if 50 sequential variants
 * are all taken something is very wrong, and we'd rather fail loud
 * than infinite-loop.
 */
export async function ensureUniqueSlug(
  base: string,
  isTaken: (candidate: string) => Promise<boolean>
): Promise<string> {
  const root = base || slugify("");
  if (!(await isTaken(root))) return root;
  for (let n = 2; n <= 50; n++) {
    const candidate = `${root}-${n}`;
    if (!(await isTaken(candidate))) return candidate;
  }
  throw new Error(
    `ensureUniqueSlug: gave up after 50 attempts for "${base}". This usually means the underlying isTaken check has a bug or the table has a degenerate naming pattern.`
  );
}
