import Link from "next/link";
import { format, formatDistanceToNowStrict } from "date-fns";

import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  findStuckSteps,
  getWorkflowAnalytics,
  STUCK_THRESHOLD_DAYS,
} from "@/lib/workflows/analytics";

export const dynamic = "force-dynamic";

export default async function WorkflowAnalyticsPage() {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "workflows");
  if (!perms.canView) {
    return (
      <AccessDenied
        module="workflows"
        moduleLabel="Workflows"
        moduleDescription="Automated onboarding, offboarding, and hiring sequences"
      />
    );
  }

  const [analytics, stuck] = await Promise.all([
    getWorkflowAnalytics(90),
    findStuckSteps(),
  ]);

  // Cap for the per-template volume bar.
  const maxVolume = Math.max(
    1,
    ...analytics.perTemplate.map(
      (t) => t.active + t.completed + t.cancelled
    )
  );

  return (
    <div>
      <PageHeader
        title="Workflow analytics"
        description="Active instances, completion rate, and stuck-step detection"
        actions={
          <Link
            href="/workflows"
            className="text-sm text-muted-foreground hover:text-foreground hover:underline"
          >
            ← Back
          </Link>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <MetricCard
          label="Active"
          value={analytics.active.toString()}
          sub="In flight or paused"
        />
        <MetricCard
          label="Completed (90d)"
          value={analytics.completedRecent.toString()}
          sub="Sealed in window"
        />
        <MetricCard
          label="Avg completion"
          value={
            analytics.avgCompletionDays == null
              ? "—"
              : `${analytics.avgCompletionDays}d`
          }
          sub="Start → completed"
        />
        <MetricCard
          label="Needs attention"
          value={analytics.stuckCount.toString()}
          sub={`Stuck > ${STUCK_THRESHOLD_DAYS}d`}
          tone={analytics.stuckCount > 0 ? "warn" : "default"}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Per template</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {analytics.perTemplate.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No instances yet.
              </p>
            ) : (
              analytics.perTemplate.map((t) => {
                const total = t.active + t.completed + t.cancelled;
                return (
                  <div key={t.templateId} className="space-y-1">
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <Link
                        href={`/workflows/templates/${t.templateId}/edit`}
                        className="font-medium hover:text-primary hover:underline truncate"
                      >
                        {t.templateName}
                      </Link>
                      <span className="text-muted-foreground tabular-nums">
                        {total} total
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden flex">
                      <div
                        className="h-full bg-primary"
                        style={{
                          width: `${(t.active / Math.max(1, total)) * 100 * (total / maxVolume)}%`,
                        }}
                        title={`${t.active} active`}
                      />
                      <div
                        className="h-full bg-success"
                        style={{
                          width: `${(t.completed / Math.max(1, total)) * 100 * (total / maxVolume)}%`,
                        }}
                        title={`${t.completed} completed`}
                      />
                      <div
                        className="h-full bg-muted-foreground/40"
                        style={{
                          width: `${(t.cancelled / Math.max(1, total)) * 100 * (total / maxVolume)}%`,
                        }}
                        title={`${t.cancelled} cancelled`}
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
                      <span>{t.active} active</span>
                      <span>{t.completed} completed</span>
                      <span>{t.cancelled} cancelled</span>
                      {t.completionRate != null && (
                        <span>· {t.completionRate}% completion</span>
                      )}
                      {t.avgCompletionDays != null && (
                        <span>· avg {t.avgCompletionDays}d</span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              Stuck steps{" "}
              <span className="text-xs text-muted-foreground font-normal">
                ({stuck.length})
              </span>
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              SCHEDULED past their time or IN_PROGRESS for more than{" "}
              {STUCK_THRESHOLD_DAYS} days. Common causes: unresolved
              approvals, portal items the subject hasn&apos;t opened.
            </p>
          </CardHeader>
          <CardContent>
            {stuck.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing stuck. ✓
              </p>
            ) : (
              <ul className="space-y-2">
                {stuck.slice(0, 10).map((s) => (
                  <li
                    key={s.instanceStepId}
                    className="rounded border border-border bg-muted/30 p-3 text-xs"
                  >
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="min-w-0">
                        <p className="text-muted-foreground">
                          {s.templateName} · {s.subjectName}
                        </p>
                        <Link
                          href={`/workflows/instances/${s.instanceId}`}
                          className="font-medium hover:text-primary hover:underline"
                        >
                          {s.stepName}
                        </Link>
                      </div>
                      <Badge variant="warning" className="text-[10px]">
                        {s.daysWaiting}d waiting
                      </Badge>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {s.status.replace(/_/g, " ").toLowerCase()} ·{" "}
                      {s.waitingSince &&
                        formatDistanceToNowStrict(s.waitingSince, {
                          addSuffix: true,
                        })}
                    </p>
                  </li>
                ))}
                {stuck.length > 10 && (
                  <li className="text-xs text-muted-foreground pt-1">
                    + {stuck.length - 10} more —{" "}
                    <Link
                      href="/workflows/instances?status=PAUSED"
                      className="text-primary hover:underline"
                    >
                      see all
                    </Link>
                  </li>
                )}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "default" | "warn";
}) {
  const valueColor =
    tone === "warn" && value !== "0" ? "text-warning" : "text-foreground";
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className={`text-2xl font-bold ${valueColor} mt-1 tabular-nums`}>
          {value}
        </p>
        <p className="text-xs text-muted-foreground mt-1">{sub}</p>
      </CardContent>
    </Card>
  );
}
