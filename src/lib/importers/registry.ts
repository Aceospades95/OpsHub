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
import { clientsImporter } from "./importers/clients";
import { certificationsImporter } from "./importers/certifications";
import { contractsImporter } from "./importers/contracts";
import { contractTermsImporter } from "./importers/contract-terms";
import { projectsImporter } from "./importers/projects";
import { projectMembersImporter } from "./importers/project-members";
import { projectRelationsImporter } from "./importers/project-relations";
import { projectToolsImporter } from "./importers/project-tools";
import { milestonesImporter } from "./importers/milestones";
import { suppliersImporter } from "./importers/suppliers";
import { supplierProjectsImporter } from "./importers/supplier-projects";
import { subcontractorsImporter } from "./importers/subcontractors";
import { partnershipsImporter } from "./importers/partnerships";
import { tasksImporter } from "./importers/tasks";
import { intranetImporter } from "./importers/intranet";
import { toolsImporter } from "./importers/tools";
import { clientContactsImporter } from "./importers/client-contacts";
import { assignmentsImporter } from "./importers/assignments";
import { allowedDomainsImporter } from "./importers/allowed-domains";
import { vehiclesImporter } from "./importers/vehicles";
import { vehicleServiceSchedulesImporter } from "./importers/vehicle-service-schedules";
import { vehicleMaintenanceImporter } from "./importers/vehicle-maintenance";
import { workLogsImporter } from "./importers/work-logs";

export const IMPORTERS: ImporterDefinition[] = [
  // Recommended import order top-to-bottom: top-level entities first,
  // then their child rows, then cross-entity links. Keeping this order in
  // the registry surfaces it in the /admin/import wizard so users
  // import in the right sequence on day one.
  usersImporter,
  clientsImporter,
  projectsImporter,
  clientContactsImporter,
  contractsImporter,
  contractTermsImporter,
  certificationsImporter,
  suppliersImporter,
  subcontractorsImporter,
  partnershipsImporter,
  toolsImporter,
  intranetImporter,
  tasksImporter,
  milestonesImporter,
  assignmentsImporter,
  projectMembersImporter,
  projectToolsImporter,
  supplierProjectsImporter,
  projectRelationsImporter,
  allowedDomainsImporter,
  // Fleet: vehicles first, then their child schedule/maintenance rows
  // (both match the vehicle by license plate).
  vehiclesImporter,
  vehicleServiceSchedulesImporter,
  vehicleMaintenanceImporter,
  // Work logs match users by email — import users first.
  workLogsImporter,
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
