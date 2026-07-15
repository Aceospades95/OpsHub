"use client";

/**
 * Client component that runs a report, renders the result as a table,
 * and offers two follow-up actions: download CSV and email to recipients.
 *
 * The report runs once on mount (so the admin always sees fresh numbers)
 * and can be re-run with the refresh button.
 */

import { useEffect, useState, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Download,
  Mail,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { runReportAction, emailReportAction } from "@/actions/reports";

interface ReportColumn {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
}
interface ReportOutput {
  summary: string;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  emptyMessage?: string;
}
interface Recipient {
  id: string;
  name: string;
  email: string;
}

interface Props {
  reportKey: string;
  reportName: string;
  recipients: Recipient[];
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    // Dates come across the action/JSON boundary as ISO strings
    return value.slice(0, 10);
  }
  return String(value);
}

export function ReportRunner({ reportKey, reportName, recipients }: Props) {
  const [output, setOutput] = useState<ReportOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, startRun] = useTransition();
  const [isEmailing, startEmail] = useTransition();

  // Email picker state
  const [pickedIds, setPickedIds] = useState<Set<string>>(new Set());
  const [extraEmail, setExtraEmail] = useState("");
  const [ccEmail, setCcEmail] = useState("");
  const [bccEmail, setBccEmail] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [emailStatus, setEmailStatus] = useState<
    | { type: "success"; message: string }
    | { type: "error"; message: string }
    | null
  >(null);

  const runReport = () => {
    setError(null);
    startRun(async () => {
      const result = await runReportAction(reportKey);
      if (!result.success) {
        setError(result.error || "Failed to run report");
        setOutput(null);
        return;
      }
      setOutput(result.output);
    });
  };

  useEffect(() => {
    runReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportKey]);

  const togglePick = (id: string) => {
    setPickedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleEmail = () => {
    setEmailStatus(null);
    const splitAddrs = (raw: string) =>
      raw.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
    const all = [...Array.from(pickedIds), ...splitAddrs(extraEmail)];
    if (all.length === 0) {
      setEmailStatus({ type: "error", message: "Pick a recipient or type an email address" });
      return;
    }
    const cc = splitAddrs(ccEmail);
    const bcc = splitAddrs(bccEmail);
    const replyToTrimmed = replyTo.trim() || undefined;
    startEmail(async () => {
      const result = await emailReportAction(reportKey, all, {
        cc,
        bcc,
        replyTo: replyToTrimmed,
      });
      if (!result.success) {
        setEmailStatus({
          type: "error",
          message: result.error || "Failed to send report",
        });
        return;
      }
      setEmailStatus({
        type: "success",
        message: `Sent to ${result.sent} of ${result.total} recipient${result.total === 1 ? "" : "s"}${result.failed > 0 ? ` (${result.failed} failed)` : ""}`,
      });
      setPickedIds(new Set());
      setExtraEmail("");
      setCcEmail("");
      setBccEmail("");
      setReplyTo("");
    });
  };

  return (
    <>
      <Card className="mb-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Result</CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={runReport}
              disabled={isRunning}
            >
              {isRunning ? (
                <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3 mr-1.5" />
              )}
              Refresh
            </Button>
            <a
              href={`/api/reports/${encodeURIComponent(reportKey)}/csv`}
              download
              className="inline-flex items-center rounded border border-border px-3 py-1.5 text-xs hover:bg-muted transition-colors"
            >
              <Download className="h-3 w-3 mr-1.5" />
              Download CSV
            </a>
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="rounded bg-destructive/10 p-3 text-sm text-destructive flex items-center gap-2 mb-3">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {isRunning && !output && (
            <div className="py-8 text-center text-muted-foreground">
              <Loader2 className="h-6 w-6 mx-auto animate-spin" />
              <p className="text-sm mt-2">Running {reportName}…</p>
            </div>
          )}

          {output && (
            <>
              <p className="text-sm text-muted-foreground mb-3">{output.summary}</p>
              {output.rows.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground text-sm">
                  {output.emptyMessage || "No rows match this report right now."}
                </div>
              ) : (
                <div className="rounded border border-border overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/30">
                      <tr>
                        {output.columns.map((c) => (
                          <th
                            key={c.key}
                            className={`p-2 font-semibold whitespace-nowrap ${
                              c.align === "right"
                                ? "text-right"
                                : c.align === "center"
                                  ? "text-center"
                                  : "text-left"
                            }`}
                          >
                            {c.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {output.rows.map((row, idx) => (
                        <tr key={idx} className="border-t border-border/50">
                          {output.columns.map((c) => {
                            const value = formatCell(row[c.key]);
                            return (
                              // max-w + truncate keeps long free-text
                              // (titles, descriptions) from stretching the
                              // whole table sideways; short numeric/date
                              // values are unaffected. Full value on hover.
                              <td
                                key={c.key}
                                title={value}
                                className={`p-2 max-w-[28rem] truncate text-muted-foreground ${
                                  c.align === "right"
                                    ? "text-right tabular-nums"
                                    : c.align === "center"
                                      ? "text-center"
                                      : "text-left"
                                }`}
                              >
                                {value}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4" />
            Email this report
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-xs font-semibold mb-2">Employees</p>
            <div className="max-h-48 overflow-y-auto rounded border border-border divide-y divide-border">
              {recipients.map((u) => (
                <label
                  key={u.id}
                  className="flex items-center gap-2 p-2 text-xs hover:bg-muted/40 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={pickedIds.has(u.id)}
                    onChange={() => togglePick(u.id)}
                  />
                  <span className="flex-1">
                    <span className="font-medium">{u.name}</span>
                    <span className="text-muted-foreground"> — {u.email}</span>
                  </span>
                </label>
              ))}
              {recipients.length === 0 && (
                <p className="p-3 text-xs text-muted-foreground">
                  No login-capable employees.
                </p>
              )}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold mb-2">Or add email addresses (To)</p>
            <input
              type="text"
              value={extraEmail}
              onChange={(e) => setExtraEmail(e.target.value)}
              placeholder="ops@example.com, finance@example.com"
              className="w-full h-9 rounded border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Comma or space separated. External addresses are allowed.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <p className="text-xs font-semibold mb-2">CC (optional)</p>
              <input
                type="text"
                value={ccEmail}
                onChange={(e) => setCcEmail(e.target.value)}
                placeholder="manager@example.com"
                className="w-full h-9 rounded border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <p className="text-xs font-semibold mb-2">BCC (optional)</p>
              <input
                type="text"
                value={bccEmail}
                onChange={(e) => setBccEmail(e.target.value)}
                placeholder="audit@example.com"
                className="w-full h-9 rounded border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold mb-2">Reply-To (optional)</p>
            <input
              type="email"
              value={replyTo}
              onChange={(e) => setReplyTo(e.target.value)}
              placeholder="ops@example.com"
              className="w-full h-9 rounded border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Helpful when From is a no-reply mailbox — replies will route
              here instead of bouncing.
            </p>
          </div>

          {emailStatus && (
            <div
              className={`rounded p-3 text-sm flex items-center gap-2 ${
                emailStatus.type === "success"
                  ? "bg-success/10 text-success"
                  : "bg-destructive/10 text-destructive"
              }`}
            >
              {emailStatus.type === "success" ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0" />
              )}
              {emailStatus.message}
            </div>
          )}

          <div className="flex items-center justify-between">
            <p className="text-[10px] text-muted-foreground">
              {pickedIds.size > 0 && (
                <>
                  <Badge variant="outline" className="text-[10px]">
                    {pickedIds.size} selected
                  </Badge>{" "}
                </>
              )}
            </p>
            <Button onClick={handleEmail} disabled={isEmailing || !output}>
              {isEmailing ? (
                <>
                  <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                  Sending…
                </>
              ) : (
                <>
                  <Mail className="h-3 w-3 mr-1.5" />
                  Send report
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
