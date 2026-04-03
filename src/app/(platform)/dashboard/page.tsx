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

  const config = await getDashboardLayout();

  // Resolve all data needed by widgets
  const [statValues, alertData, activityLogs] = await Promise.all([
    resolveAllStats(config.widgets),
    getAlertData(),
    getActivityForWidget(),
  ]);

  // Find task list widget config
  const taskWidget = config.widgets.find((w) => w.type === "task-list");
  const taskConfig = taskWidget?.config as TaskListConfig | undefined;
  const tasks = await getTasksForWidget(
    session.user.id,
    taskConfig?.scope || "mine",
    taskConfig?.limit || 8
  );

  // Serialize dates for client component
  const serializedTasks = tasks.map((t) => ({
    ...t,
    dueDate: t.dueDate ? t.dueDate.toISOString() : null,
  }));
  const serializedLogs = activityLogs.map((l) => ({
    ...l,
    createdAt: l.createdAt.toISOString(),
  }));

  const canEdit = session.user.role === "ADMIN" || session.user.role === "DEVELOPER";

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description={`Welcome back, ${session.user.name}`}
      />
      <DashboardGrid
        config={config}
        statValues={statValues}
        tasks={serializedTasks}
        activityLogs={serializedLogs}
        alertData={alertData}
        canEdit={canEdit}
        userId={session.user.id}
      />
    </div>
  );
}
