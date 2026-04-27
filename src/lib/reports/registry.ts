/**
 * Report registry — canonical list of every report OpsHub knows how to run.
 *
 * Adding a new report:
 *   1. Create a new file in src/lib/reports/reports/ exporting a ReportDefinition
 *   2. Import it here and add it to REPORTS
 *   3. The admin /admin/reports page picks it up automatically
 *
 * Reports are read-only — the run() handler should never mutate data.
 */

import type { ReportDefinition } from "./types";
import { contractsExpiring } from "./reports/contracts-expiring";
import { certificationsExpiring } from "./reports/certifications-expiring";
import { teamUtilization } from "./reports/team-utilization";
import { projectStatus } from "./reports/project-status";
import { activityAudit } from "./reports/activity-audit";
import { activityAuditFull } from "./reports/activity-audit-full";
import { quotePipeline } from "./reports/quote-pipeline";
import { workflowHealth } from "./reports/workflow-health";

export const REPORTS: ReportDefinition[] = [
  contractsExpiring,
  certificationsExpiring,
  teamUtilization,
  projectStatus,
  quotePipeline,
  workflowHealth,
  activityAudit,
  activityAuditFull,
];

const REPORT_MAP = new Map<string, ReportDefinition>(REPORTS.map((r) => [r.key, r]));

/** Look up a report by key. Returns undefined if unknown. */
export function getReport(key: string): ReportDefinition | undefined {
  return REPORT_MAP.get(key);
}

/** Every registered report. Used by the admin UI and schedulable picker. */
export function listReports(): ReportDefinition[] {
  return REPORTS;
}

/** Reports that opt in to being included in scheduled email digests. */
export function listSchedulableReports(): ReportDefinition[] {
  return REPORTS.filter((r) => r.schedulable !== false);
}
