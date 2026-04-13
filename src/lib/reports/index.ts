/**
 * Reports infrastructure — public API.
 *
 * One entry point (`runReport`) executes a registered report by key and
 * returns a structured ReportOutput. Downstream callers format that
 * output into CSV, HTML, or plain text via the helpers in ./format.
 */

import { getReport, listReports, listSchedulableReports, REPORTS } from "./registry";
import type { ReportContext, ReportOutput } from "./types";

export type {
  ReportColumn,
  ReportContext,
  ReportDefinition,
  ReportOutput,
} from "./types";
export { REPORTS, listReports, listSchedulableReports, getReport };
export { renderCsv, renderHtml, renderText, formatCell } from "./format";

/**
 * Run a report by key. Returns the structured ReportOutput plus metadata
 * suitable for embedding in an email subject or a download filename.
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
}> {
  const report = getReport(key);
  if (!report) throw new Error(`Unknown report key: ${key}`);
  const output = await report.run(ctx);
  return {
    output,
    name: report.name,
    description: report.description,
  };
}
