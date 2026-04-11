/**
 * Importer registry — the canonical list of every CSV importer.
 *
 * Adding a new importer:
 *   1. Create a new file in src/lib/importers/importers/ exporting an
 *      ImporterDefinition with key, name, fields, and commit handler
 *   2. Import it here and add it to IMPORTERS
 *   3. The admin /admin/import wizard picks it up automatically
 *
 * Each importer is responsible for its own validation, deduplication,
 * and DB writes — the registry just provides discovery.
 */

import type { ImporterDefinition } from "./types";
import { usersImporter } from "./importers/users";

export const IMPORTERS: ImporterDefinition[] = [
  usersImporter,
  // clientsImporter,
  // projectsImporter,
];

const IMPORTER_MAP = new Map<string, ImporterDefinition>(
  IMPORTERS.map((i) => [i.key, i])
);

/** Look up an importer by key. Returns undefined if unknown. */
export function getImporter(key: string): ImporterDefinition | undefined {
  return IMPORTER_MAP.get(key);
}

/** Return every registered importer. Used by the admin wizard list. */
export function listImporters(): ImporterDefinition[] {
  return IMPORTERS;
}
