import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import {
  getDashboardLayout,
  resolveAllStats,
  getTasksForWidget,
  getActivityForWidget,
  getAlertData,
} from "@/actions/dashboard-layout";
import { DashboardGridLoader as DashboardGrid } from "./dashboard-grid-loader";
import type { TaskListConfig } from "@/lib/dashboard-widgets";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  let dashboardContent: React.ReactNode;

  try {
    const config = await getDashboardLayout();

    const [statValues, alertData, activityLogs] = await Promise.all([
      resolveAllStats(config.widgets),
      getAlertData(),
      getActivityForWidget(),
    ]);

    const taskWidget = config.widgets.find((w) => w.type === "task-list");
    const taskConfig = taskWidget?.config as TaskListConfig | undefined;
    const tasks = await getTasksForWidget(
      session.user.id,
      taskConfig?.scope || "mine",
      taskConfig?.limit || 8
    );

    const serializedTasks = tasks.map((t) => ({
      ...t,
      dueDate: t.dueDate ? t.dueDate.toISOString() : null,
    }));
    const serializedLogs = activityLogs.map((l) => ({
      ...l,
      createdAt: l.createdAt.toISOString(),
    }));

    const canEdit = session.user.role === "ADMIN" || session.user.role === "DEVELOPER";

    dashboardContent = (
      <DashboardGrid
        config={config}
        statValues={statValues}
        tasks={serializedTasks}
        activityLogs={serializedLogs}
        alertData={alertData}
        canEdit={canEdit}
        userId={session.user.id}
      />
    );
  } catch (err) {
    console.error("Dashboard data loading error:", err);
    dashboardContent = (
      <div className="rounded border border-destructive/50 bg-destructive/5 p-6 text-sm">
        <p className="font-medium text-destructive mb-2">Dashboard failed to load</p>
        <p className="text-muted-foreground">{err instanceof Error ? err.message : "Unknown error"}</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description={`Welcome back, ${session.user.name}`}
      />
      {dashboardContent}
    </div>
  );
}
