/**
 * Maps a system report's `module` to the custom-report entity that
 * queries the same table, powering the "Duplicate as custom report"
 * link on system report pages. A system report whose module has no
 * entry (bids, workflows, work-logs, admin) simply doesn't offer the
 * link — its query has no custom-builder equivalent yet.
 *
 * Pure data, safe to import from client and server components alike.
 */

import type { CustomReportEntity } from "@prisma/client";

export const REPORT_MODULE_TO_ENTITY: Partial<Record<string, CustomReportEntity>> = {
  projects: "PROJECT",
  contracts: "CONTRACT",
  certifications: "CERTIFICATION",
  quotes: "QUOTE",
  subcontractors: "SUBCONTRACTOR",
  partnerships: "PARTNERSHIP",
  team: "USER",
};
