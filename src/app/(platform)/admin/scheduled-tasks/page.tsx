import { requireAuth } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { format, formatDistanceToNowStrict } from "date-fns";

import { db } from "@/lib/db";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { CalendarClock } from "lucide-react";
import { listReports } from "@/lib/reports/registry";
import { describeCadence } from "@/lib/scheduled-tasks/scheduling";

import { ScheduledTaskCreateButton } from "./create-button";
import { TaskRowActions } from "./row-actions";

const TYPE_LABEL: Record<string, string> = {
  EMAIL_REPORT: "Email a report",
  EMAIL_MESSAGE: "Broadcast a message",
};

export const metadata = { title: "Scheduled Tasks · OpsHub" };

export default async function ScheduledTasksPage() {
  const user = await requireAuth();
  if (user.role !== "ADMIN") redirect("/dashboard");

  const tasks = await db.scheduledTask.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    include: { createdBy: { select: { id: true, name: true } } },
  });

  // Reports the EMAIL_REPORT task type can target. Combines:
  //   - System reports (code-defined in src/lib/reports/)
  //   - Active custom reports (admin-built in /admin/reports/custom)
  // Custom reports get a "custom:" prefix on their key so the
  // EMAIL_REPORT handler can dispatch correctly.
  const [customReports] = await Promise.all([
    db.customReport.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, description: true },
    }),
  ]);
  const systemReports = listReports().map((r) => ({
    key: r.key,
    name: r.name,
    description: r.description,
  }));
  const reports = [
    ...customReports.map((r) => ({
      key: `custom:${r.id}`,
      name: `${r.name} (custom)`,
      description: r.description ?? "Custom report",
    })),
    ...systemReports,
  ];

  return (
    <div>
      <PageHeader
        title="Scheduled tasks"
        description="Admin-built recurring tasks. Email a report on a schedule, broadcast a status message, etc."
        actions={<ScheduledTaskCreateButton reports={reports} />}
      />

      <div className="rounded border border-dashed border-border bg-muted/30 p-4 text-xs text-muted-foreground mb-6">
        These tasks are evaluated hourly by the{" "}
        <code>custom-scheduled-tasks</code> cron job. Configure your
        cron provider to POST{" "}
        <code>/api/jobs/run?job=custom-scheduled-tasks</code> every hour
        — without that, scheduled tasks won&apos;t fire automatically (you
        can still &quot;Run now&quot; from the row actions).
      </div>

      {tasks.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="No scheduled tasks yet"
          description="Create one to email a report on a schedule or broadcast a recurring status message."
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Name</th>
                    <th className="px-4 py-3 text-left font-medium">Type</th>
                    <th className="px-4 py-3 text-left font-medium">Schedule</th>
                    <th className="px-4 py-3 text-left font-medium">Last run</th>
                    <th className="px-4 py-3 text-left font-medium">Status</th>
                    <th className="px-4 py-3 text-right font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((t) => {
                    let parsedConfig: Record<string, unknown> = {};
                    try {
                      parsedConfig = JSON.parse(t.config);
                    } catch {
                      parsedConfig = {};
                    }
                    return (
                      <tr
                        key={t.id}
                        className="border-t border-border hover:bg-muted/40 transition-colors"
                      >
                        <td className="px-4 py-3">
                          <p className="font-medium">{t.name}</p>
                          {t.description && (
                            <p className="text-xs text-muted-foreground line-clamp-1">
                              {t.description}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {TYPE_LABEL[t.taskType] ?? t.taskType}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">
                          {describeCadence({
                            frequency: t.frequency,
                            hourUtc: t.hourUtc,
                            dayOfWeek: t.dayOfWeek,
                            dayOfMonth: t.dayOfMonth,
                          })}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {t.lastRunAt
                            ? `${formatDistanceToNowStrict(t.lastRunAt, { addSuffix: true })} (${format(t.lastRunAt, "MMM d, HH:mm")})`
                            : "—"}
                          {t.lastRunOutput && (
                            <p className="text-[10px] mt-0.5 line-clamp-1">
                              {t.lastRunOutput}
                            </p>
                          )}
                          {t.lastRunError && (
                            <p className="text-[10px] mt-0.5 text-destructive line-clamp-2">
                              {t.lastRunError}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1">
                            {t.isActive ? (
                              <Badge variant="success" className="text-[10px] w-fit">
                                Active
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] w-fit">
                                Disabled
                              </Badge>
                            )}
                            {t.lastRunStatus === "failed" && (
                              <Badge variant="destructive" className="text-[10px] w-fit">
                                Last run failed
                              </Badge>
                            )}
                            {t.lastRunStatus === "success" && t.lastRunError && (
                              <Badge variant="warning" className="text-[10px] w-fit">
                                Partial
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <TaskRowActions
                            task={{
                              id: t.id,
                              name: t.name,
                              description: t.description,
                              taskType: t.taskType,
                              frequency: t.frequency,
                              hourUtc: t.hourUtc,
                              dayOfWeek: t.dayOfWeek,
                              dayOfMonth: t.dayOfMonth,
                              config: parsedConfig,
                              isActive: t.isActive,
                            }}
                            reports={reports}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
