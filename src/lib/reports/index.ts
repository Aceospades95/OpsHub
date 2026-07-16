/**
 * Reports infrastructure — public API.
 *
 * One entry point (`runReport`) executes a registered report by key and
 * returns a structured ReportOutput. Downstream callers format that
 * output into CSV, HTML, or plain text via the helpers in ./format.
 */

import { getReport, listReports, listSchedulableReports, REPORTS } from "./registry";
import { applyReportOverride, getReportOverride } from "./overrides";
import type { ReportOverrideData } from "./overrides";
import type { ReportContext, ReportOutput } from "./types";

export type {
  ReportColumn,
  ReportContext,
  ReportDefinition,
  ReportOutput,
} from "./types";
export { REPORTS, listReports, listSchedulableReports, getReport };
export { renderCsv, renderHtml, renderText, formatCell } from "./format";
export {
  applyReportOverride,
  getAllReportOverrides,
  getReportOverride,
  parseColumnConfig,
} from "./overrides";
export type { ReportColumnOverride, ReportOverrideData } from "./overrides";

/**
 * Run a report by key. Returns the structured ReportOutput plus metadata
 * suitable for embedding in an email subject or a download filename.
 *
 * Admin customizations (ReportOverride) are applied HERE — the single
 * choke point — so every consumer (admin runner, CSV download, emailed
 * reports, scheduled tasks, daily digest) sees the same renamed /
 * relabeled / reordered / capped shape. The stock* fields carry the
 * untouched code-defined values for UIs that let admins edit the
 * override (placeholders, "reset to default" targets).
 *
 * `hidden` is advisory metadata: the report still runs (an admin
 * clicking into a hidden report should see data), but pickers, digests,
 * and scheduled sends check it to keep the report out of circulation.
 *
 * Throws if the key is unknown — callers should guard at the routing
 * layer so this only fires on programmer error.
 */
export async function runReport(
  key: string,
  ctx: ReportContext
): Promise<{
  output: ReportOutput;
  name: string;
  description: string;
  stockName: string;
  stockDescription: string;
  stockColumns: { key: string; label: string }[];
  hidden: boolean;
  overridden: boolean;
  override: ReportOverrideData | null;
}> {
  const report = getReport(key);
  if (!report) throw new Error(`Unknown report key: ${key}`);
  const override = await getReportOverride(key);
  const raw = await report.run(ctx);
  const stockColumns = raw.columns.map((c) => ({ key: c.key, label: c.label }));
  const output = applyReportOverride(raw, override);
  return {
    output,
    name: override?.displayName || report.name,
    description: override?.description || report.description,
    stockName: report.name,
    stockDescription: report.description,
    stockColumns,
    hidden: override?.hidden ?? false,
    overridden: override != null,
    override,
  };
}
