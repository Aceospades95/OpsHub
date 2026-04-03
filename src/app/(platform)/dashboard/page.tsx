import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/layout/page-header";
import { WidgetGridLoader as WidgetGrid } from "@/components/shared/widget-grid-loader";
import { getWidgetLayout, resolveStatValue, getCustomWidgets } from "@/actions/widgets";
import { getDefaultPageLayout, type PageWidgetLayout, type StatConfig } from "@/lib/widget-registry";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { CheckSquare, Clock, AlertTriangle, Activity } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { DashboardTaskCheckbox } from "./dashboard-task-checkbox";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { id: userId, role } = session.user;
  const canEdit = role === "ADMIN" || role === "DEVELOPER";

  let config: PageWidgetLayout;
  try {
    const saved = await getWidgetLayout("dashboard");
    config = saved || getDefaultPageLayout("dashboard");
  } catch {
    config = getDefaultPageLayout("dashboard");
  }

  // Resolve stat values for all stat widgets
  const statValues: Record<string, number> = {};
  for (const widget of config.widgets) {
    if (widget.type === "stat" && widget.config.model) {
      const cfg = widget.config as unknown as StatConfig;
      statValues[widget.id] = await resolveStatValue(cfg.model, cfg.filter || {});
    }
  }

  // Load data for system widgets
  const [myTasks, activityLogs, expiringContracts, customWidgets] = await Promise.all([
    db.task.findMany({
      where: { status: { in: ["TODO", "IN_PROGRESS"] }, assigneeId: userId },
      take: 8,
      orderBy: [{ priority: "asc" }, { dueDate: "asc" }],
      include: {
        project: { select: { id: true, name: true } },
        client: { select: { id: true, name: true } },
        assignee: { select: { name: true } },
      },
    }),
    db.activityLog.findMany({
      take: 10,
      orderBy: { createdAt: "desc" },
      include: { user: { select: { name: true } } },
    }),
    db.contract.count({ where: { status: { in: ["EXPIRING_SOON", "EXPIRED"] } } }),
    getCustomWidgets(),
  ]);

  const priorityColors: Record<string, string> = {
    HIGH: "bg-red-100 text-red-800",
    MEDIUM: "bg-yellow-100 text-yellow-800",
    LOW: "bg-green-100 text-green-800",
  };

  // Build system widget content map
  const systemWidgets: Record<string, React.ReactNode> = {
    "my-tasks": (
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <h3 className="text-sm font-semibold flex items-center gap-2"><CheckSquare className="h-4 w-4" /> My Tasks</h3>
          <Link href="/tasks?assignee=me" className="text-xs text-primary hover:underline">View all</Link>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-4">
          {myTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">No open tasks</p>
          ) : (
            <div className="space-y-2">
              {myTasks.map((task) => (
                <div key={task.id} className="flex items-center gap-3 py-1">
                  <DashboardTaskCheckbox taskId={task.id} status={task.status} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{task.title}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${priorityColors[task.priority]}`}>{task.priority}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {task.project && <span>{task.project.name}</span>}
                      {task.dueDate && (
                        <span className={new Date(task.dueDate) < new Date() ? "text-destructive" : ""}>
                          <Clock className="h-3 w-3 inline mr-0.5" />{format(task.dueDate, "MMM d")}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    ),
    activity: (
      <div className="h-full flex flex-col">
        <div className="px-5 pt-4 pb-2">
          <h3 className="text-sm font-semibold flex items-center gap-2"><Activity className="h-4 w-4" /> Recent Activity</h3>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-4">
          {activityLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recent activity</p>
          ) : (
            <div className="space-y-3">
              {activityLogs.map((log) => (
                <div key={log.id} className="flex items-start gap-3">
                  <Avatar name={log.user.name} size="xs" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">
                      <span className="font-medium">{log.user.name}</span>{" "}
                      <span className="text-muted-foreground">{log.action} {log.entityType}</span>
                      {log.details && <span className="text-muted-foreground"> — {log.details}</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">{formatDistanceToNow(log.createdAt, { addSuffix: true })}</p>
                  </div>
                  <Badge variant="outline" className="shrink-0 text-[10px]">{log.action}</Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    ),
    alerts: expiringContracts > 0 ? (
      <div className="flex items-center gap-3 h-full px-5">
        <AlertTriangle className="h-5 w-5 text-warning shrink-0" />
        <p className="text-sm">
          <strong>{expiringContracts}</strong> contract{expiringContracts !== 1 ? "s" : ""} expiring soon or expired.{" "}
          <Link href="/contracts" className="text-primary hover:underline">Review now</Link>
        </p>
      </div>
    ) : (
      <div className="flex items-center gap-3 h-full px-5">
        <span className="text-sm text-muted-foreground">No active alerts</span>
      </div>
    ),
  };

  return (
    <div>
      <PageHeader title="Dashboard" description={`Welcome back, ${session.user.name}`} />
      <WidgetGrid
        pageType="dashboard"
        initialLayout={config}
        systemWidgets={systemWidgets}
        customWidgets={customWidgets.map((w) => ({ id: w.id, name: w.name, type: w.type, config: w.config }))}
        statValues={statValues}
        canEdit={canEdit}
      />
    </div>
  );
}
