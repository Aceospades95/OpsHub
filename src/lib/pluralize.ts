/**
 * Pluralize helpers for count labels.
 *
 * Round-2 QA flagged "1 projects", "0 projects", "1 contracts", "0
 * contacts" everywhere — across clients, projects, tasks, contracts,
 * suppliers, partnerships, certifications, tools, intranet. Single
 * helper used at every count site fixes them all.
 *
 * Three shapes:
 *   - `pluralize(count, "project")`            → "1 project" / "2 projects"
 *   - `pluralize(count, "ally", "allies")`     → "2 allies" (irregular)
 *   - `pluralizeWord(count, "project")`        → "project" / "projects" only
 *     (when the count is rendered separately from the word, e.g.
 *     `{count} <Badge>{pluralizeWord(count, "task")}</Badge>`)
 */

/**
 * Return "<count> <word>" with the word pluralized when count !== 1.
 *
 * Defaults the plural to `${word}s`. Pass `plural` explicitly for
 * irregulars: pluralize(count, "ally", "allies"), pluralize(count,
 * "person", "people").
 */
export function pluralize(
  count: number,
  word: string,
  plural?: string
): string {
  return `${count} ${pluralizeWord(count, word, plural)}`;
}

/**
 * Return just the word, pluralized when count !== 1.
 */
export function pluralizeWord(
  count: number,
  word: string,
  plural?: string
): string {
  if (count === 1) return word;
  return plural ?? `${word}s`;
}
