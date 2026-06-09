import { requireAuth } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow, format } from "date-fns";
import { Mail, AlertCircle, CheckCircle2 } from "lucide-react";
import { EmailLogActions } from "./email-log-actions";

export const metadata = { title: "Email Log · OpsHub" };

export default async function AdminEmailsPage() {
  const user = await requireAuth();
  if (user.role !== "ADMIN") redirect("/dashboard");

  const [logs, totals] = await Promise.all([
    db.emailLog.findMany({
      orderBy: { sentAt: "desc" },
      take: 100,
    }),
    db.emailLog.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
  ]);

  const sentCount = totals.find((t) => t.status === "sent")?._count._all ?? 0;
  const failedCount = totals.find((t) => t.status === "failed")?._count._all ?? 0;

  const activeDriver = process.env.EMAIL_DRIVER || "log";

  return (
    <div>
      <PageHeader
        title="Email Log"
        description="Every outbound email routed through the platform is recorded here"
        actions={<EmailLogActions />}
      />

      {/* Active driver banner */}
      <Card className="mb-6">
        <CardContent className="py-4 flex items-center gap-3">
          <Mail className="h-5 w-5 text-muted-foreground" />
          <div className="flex-1">
            <p className="text-sm">
              Active driver:{" "}
              <Badge variant="outline" className="font-mono">{activeDriver}</Badge>
            </p>
            {activeDriver === "log" && (
              <p className="text-xs text-muted-foreground mt-1">
                The log driver records attempts here but does not actually deliver mail. Set EMAIL_DRIVER
                in env and register a real driver in <code>src/lib/email/drivers.ts</code> to enable sending.
              </p>
            )}
          </div>
          <div className="flex gap-4">
            <div className="text-center">
              <p className="text-2xl font-semibold text-emerald-600">{sentCount}</p>
              <p className="text-xs text-muted-foreground">Sent</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-semibold text-destructive">{failedCount}</p>
              <p className="text-xs text-muted-foreground">Failed</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Log entries */}
      <Card>
        <CardHeader>
          <CardTitle>Recent (last 100)</CardTitle>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <Mail className="h-12 w-12 mx-auto mb-3 opacity-40" />
              <p className="text-sm">No emails have been sent yet.</p>
              <p className="text-xs mt-2">Use the &ldquo;Send test email&rdquo; button above to verify the pipeline.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className="flex items-start gap-3 rounded border border-border p-3 hover:bg-muted/30 transition-colors"
                >
                  {log.status === "sent" ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{log.subject}</p>
                      {log.templateKey && (
                        <Badge variant="outline" className="text-[10px] font-mono">{log.templateKey}</Badge>
                      )}
                      <Badge variant="outline" className="text-[10px]">{log.driver}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      To: {log.toAddresses} · From: {log.fromAddress}
                    </p>
                    {log.error && (
                      <p className="text-xs text-destructive mt-1 font-mono break-all">{log.error}</p>
                    )}
                    {log.entityType && log.entityId && (
                      <p className="text-[10px] text-muted-foreground/70 mt-1">
                        Ref: {log.entityType}:{log.entityId}
                      </p>
                    )}
                  </div>
                  <div
                    className="text-xs text-muted-foreground text-right shrink-0"
                    title={format(log.sentAt, "yyyy-MM-dd HH:mm:ss")}
                  >
                    {formatDistanceToNow(log.sentAt, { addSuffix: true })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
