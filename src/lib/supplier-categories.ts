/**
 * Supplier category normalization — every write path (create/update
 * forms via resolveCategory, the CSV importer) must store the same
 * snake_case shape ("Fleet Maintenance" → "fleet_maintenance") so
 * group-by buckets, the category picker, and filters treat equal
 * categories as equal. Display layers title-case the stored value.
 */
export function normalizeSupplierCategory(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
