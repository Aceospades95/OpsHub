/**
 * Shared grouping for list/table views. Every module's "group by X"
 * dropdown funnels through this so group ordering and the ungrouped
 * bucket behave identically everywhere.
 */

export interface RowGroup<T> {
  /** Display label for the group header. */
  label: string;
  rows: T[];
}

/** Label used for rows whose group key is null/empty. Always sorts last. */
export const UNGROUPED_LABEL = "Not set";

/**
 * Bucket `rows` by `keyOf`, preserving the incoming row order within each
 * group. Groups come back alphabetically (case-insensitive), with the
 * null/empty bucket last — scanning a grouped page should feel like a
 * sorted index, not insertion order.
 */
export function groupRows<T>(
  rows: T[],
  keyOf: (row: T) => string | null | undefined
): RowGroup<T>[] {
  const buckets = new Map<string, T[]>();
  for (const row of rows) {
    const raw = keyOf(row);
    const label = raw && raw.trim().length > 0 ? raw.trim() : UNGROUPED_LABEL;
    const bucket = buckets.get(label);
    if (bucket) bucket.push(row);
    else buckets.set(label, [row]);
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => {
      if (a === UNGROUPED_LABEL) return 1;
      if (b === UNGROUPED_LABEL) return -1;
      return a.localeCompare(b, undefined, { sensitivity: "base" });
    })
    .map(([label, groupedRows]) => ({ label, rows: groupedRows }));
}
