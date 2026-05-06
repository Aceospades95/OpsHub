/**
 * Recently-viewed entity tracking.
 *
 * Lives in localStorage so the list survives a page reload but stays
 * scoped to the user's machine — no DB column, no cross-device sync.
 * That's by design: the QA report's ask was a low-friction "what was
 * I just in" hint on the dashboard, not a synced history.
 *
 * Each entry is a small {type, id, label} record; we store at most
 * 12 across all entity types, with the most recent first. Bumping
 * an entity that's already in the list moves it to the front rather
 * than duplicating.
 */

const STORAGE_KEY = "opshub:recently-viewed:v1";
const MAX_ENTRIES = 12;

export type RecentEntityType =
  | "project"
  | "client"
  | "employee"
  | "supplier"
  | "contract"
  | "quote"
  | "tool"
  | "intranet"
  | "subcontractor"
  | "partnership"
  | "certification";

export interface RecentEntry {
  type: RecentEntityType;
  id: string;
  label: string;
  /** Optional sub-label (e.g. client name on a project). */
  sublabel?: string;
  /** Absolute path component, e.g. "/projects/abc". */
  href: string;
  /** Unix ms when the entry was last touched. */
  visitedAt: number;
}

function readSafe(): RecentEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is RecentEntry =>
        e &&
        typeof e === "object" &&
        typeof e.id === "string" &&
        typeof e.type === "string" &&
        typeof e.label === "string" &&
        typeof e.href === "string" &&
        typeof e.visitedAt === "number"
    );
  } catch {
    return [];
  }
}

function writeSafe(entries: RecentEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(entries.slice(0, MAX_ENTRIES))
    );
  } catch {
    // Quota exceeded / disabled storage — nothing we can do, and
    // missing recents shouldn't block the page.
  }
}

/** Push or bump an entry to the front of the list. */
export function trackRecent(entry: Omit<RecentEntry, "visitedAt">): void {
  const now = Date.now();
  const existing = readSafe().filter(
    (e) => !(e.type === entry.type && e.id === entry.id)
  );
  const next: RecentEntry[] = [{ ...entry, visitedAt: now }, ...existing].slice(
    0,
    MAX_ENTRIES
  );
  writeSafe(next);
}

/** Read the current list, freshest first. */
export function getRecent(limit = MAX_ENTRIES): RecentEntry[] {
  return readSafe().slice(0, limit);
}

/** Clear all entries — exposed for the "Clear recents" affordance if
 *  we ever add one (no callers today). */
export function clearRecent(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Same fail-silent reasoning as writeSafe.
  }
}
