/**
 * Importer registry — the canonical list of every CSV importer.
 *
 * To add a new importer:
 *   1. Create a file in src/lib/importers/importers/<key>.ts that exports
 *      an ImporterDefinition (key, name, description, module, fields,
 *      commit handler, optional sampleRows()).
 *   2. Import it here and append it to IMPORTERS below.
 *   3. The /admin/import wizard, the template download endpoint
 *      (/api/import/[key]/template), and the audit log all pick the
 *      new importer up automatically — no other wiring needed.
 *
 * Each importer is responsible for its own validation, deduplication,
 * and DB writes — the registry just provides discovery.
 */

import type { ImporterDefinition } from "./types";
import { usersImporter } from "./importers/users";
import { certificationsImporter } from "./importers/certifications";
import { contractsImporter } from "./importers/contracts";
import { contractTermsImporter } from "./importers/contract-terms";
import { projectsImporter } from "./importers/projects";
import { suppliersImporter } from "./importers/suppliers";
import { tasksImporter } from "./importers/tasks";
import { intranetImporter } from "./importers/intranet";
import { toolsImporter } from "./importers/tools";
import { clientContactsImporter } from "./importers/client-contacts";
import { assignmentsImporter } from "./importers/assignments";

export const IMPORTERS: ImporterDefinition[] = [
  usersImporter,
  projectsImporter,
  clientContactsImporter,
  contractsImporter,
  contractTermsImporter,
  certificationsImporter,
  suppliersImporter,
  toolsImporter,
  intranetImporter,
  tasksImporter,
  assignmentsImporter,
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
