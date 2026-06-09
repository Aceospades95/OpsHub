import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/permissions";
import { getUserScope } from "@/lib/scope";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { CheckSquare } from "lucide-react";
import { TaskCreateButton } from "./task-create-button";
import { TaskCheckbox } from "./task-checkbox";
import { TaskFilters } from "./task-filters";
import { TasksListClient } from "./tasks-list-client";
import { DownloadCsvButton } from "@/components/shared/download-csv-button";
import { Suspense } from "react";
import { formatCalendarDate } from "@/lib/dates";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { pluralize } from "@/lib/pluralize";

const priorityColors: Record<string, string> = {
  HIGH: "bg-red-100 text-red-800",
  MEDIUM: "bg-yellow-100 text-yellow-800",
  LOW: "bg-green-100 text-green-800",
};

const statusLabels: Record<string, string> = {
  TODO: "To Do",
  IN_PROGRESS: "In Progress",
  DONE: "Done",
  CANCELLED: "Cancelled",
};

export const metadata = { title: "Tasks · OpsHub" };

export default async function TasksPage({
  searchParams,
}: {
  searchParams: {
    assignee?: string;
    project?: string;
    client?: string;
    show?: string;
    view?: string;
    /** Filter chip: "overdue" or "week". Empty / unknown = no filter. */
    due?: string;
  };
}) {
  const user = await requireAuth();

  const { assignee, project, client, show, view, due } = searchParams;
  // Default view is grouped by status. "by-project" groups by project name.
  const groupBy = view === "by-project" ? "project" : "status";

  const scope = await getUserScope(user.id, user.role);

  // Build filter
  const where: Prisma.TaskWhereInput = { deletedAt: null };

  if (assignee === "me") {
    where.assigneeId = user.id;
  } else if (assignee === "unassigned") {
    where.assigneeId = null;
  } else if (assignee && assignee !== "all") {
    where.assigneeId = assignee;
  }

  if (project === "none") {
    where.projectId = null;
  } else if (project) {
    where.projectId = project;
  }

  if (client) {
    where.clientId = client;
  }

  if (show === "active") {
    where.status = { in: ["TODO", "IN_PROGRESS"] };
  } else if (show === "done") {
    where.status = "DONE";
  }
  // default: show all

  // Due-date chips. "overdue" = dueDate < today AND task isn't already
  // DONE/CANCELLED. "week" = dueDate within the next 7 calendar days
  // (today inclusive). We treat dates as UTC midnights to match the
  // calendar-date convention introduced in chunk B.
  if (due === "overdue") {
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);
    where.dueDate = { lt: startOfToday };
    where.status = { in: ["TODO", "IN_PROGRESS"] };
  } else if (due === "week") {
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);
    const weekFromNow = new Date(startOfToday.getTime() + 7 * 24 * 60 * 60 * 1000);
    where.dueDate = { gte: startOfToday, lt: weekFromNow };
  }

  // Scope: non-org-wide roles only see tasks in projects/clients they can
  // access or tasks where they are the assignee or creator.
  if (!scope.all) {
    const scopeOr: Prisma.TaskWhereInput[] = [
      { assigneeId: user.id },
      { createdById: user.id },
    ];
    if (scope.projectIds.size > 0) {
      scopeOr.push({ projectId: { in: Array.from(scope.projectIds) } });
    }
    if (scope.clientIds.size > 0) {
      scopeOr.push({ clientId: { in: Array.from(scope.clientIds) } });
    }
    where.AND = [...((where.AND as Prisma.TaskWhereInput[]) ?? []), { OR: scopeOr }];
  }

  const scopedProjectIds = scope.all ? null : Array.from(scope.projectIds);
  const scopedClientIds = scope.all ? null : Array.from(scope.clientIds);

  const [tasks, projects, clients, users] = await Promise.all([
    db.task.findMany({
      where,
      orderBy: [{ status: "asc" }, { priority: "asc" }, { dueDate: "asc" }],
      // `description` is included so the TaskDrawer can display + edit
      // it without a second round-trip when a row is opened.
      include: {
        project: { select: { id: true, name: true } },
        client: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true } },
        createdBy: { select: { name: true } },
      },
      // Cap the unfiltered list — matches the 500-row cap on /quotes.
      take: 500,
    }),
    db.project.findMany({
      where: { deletedAt: null, ...(scopedProjectIds ? { id: { in: scopedProjectIds } } : {}) },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.client.findMany({
      where: { deletedAt: null, ...(scopedClientIds ? { id: { in: scopedClientIds } } : {}) },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.user.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const activeTasks = tasks.filter((t) => t.status !== "DONE" && t.status !== "CANCELLED");
  const completedTasks = tasks.filter((t) => t.status === "DONE" || t.status === "CANCELLED");

  // Active filter label
  const filterParts: string[] = [];
  if (assignee === "me") filterParts.push("assigned to you");
  else if (assignee === "unassigned") filterParts.push("unassigned");
  else if (assignee) {
    const u = users.find((u) => u.id === assignee);
    if (u) filterParts.push(`assigned to ${u.name}`);
  }
  if (project) {
    const p = projects.find((p) => p.id === project);
    if (p) filterParts.push(p.name);
  }
  if (client) {
    const c = clients.find((c) => c.id === client);
    if (c) filterParts.push(c.name);
  }
  const filterLabel = filterParts.length > 0
    ? `Showing: ${filterParts.join(" · ")}`
    : "Showing all tasks";

  return (
    <div>
      <PageHeader
        title="Tasks"
        description="Track and manage tasks across projects and clients"
        actions={
          <div className="flex items-center gap-2">
            {user.role === "ADMIN" && <DownloadCsvButton importerKey="tasks" />}
            <TaskCreateButton projects={projects} clients={clients} users={users} />
          </div>
        }
      />

      <Suspense fallback={null}>
        <TaskFilters
          projects={projects}
          clients={clients}
          users={users}
          currentAssignee={assignee}
          currentProject={project}
          currentClient={client}
          currentShow={show}
          currentDue={due}
          currentUserId={user.id}
        />
      </Suspense>

      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-muted-foreground">{filterLabel} — {pluralize(tasks.length, "task")}</p>
        {/* View mode: status (default) vs grouped by project */}
        <div className="flex rounded-md border border-border overflow-hidden">
          <Link
            href={{
              pathname: "/tasks",
              query: {
                ...(assignee ? { assignee } : {}),
                ...(project ? { project } : {}),
                ...(client ? { client } : {}),
                ...(show ? { show } : {}),
              },
            }}
            className={`px-3 py-1 text-xs font-medium transition-colors ${
              groupBy === "status" ? "bg-primary text-primary-foreground" : "hover:bg-muted"
            }`}
          >
            By status
          </Link>
          <Link
            href={{
              pathname: "/tasks",
              query: {
                ...(assignee ? { assignee } : {}),
                ...(project ? { project } : {}),
                ...(client ? { client } : {}),
                ...(show ? { show } : {}),
                view: "by-project",
              },
            }}
            className={`px-3 py-1 text-xs font-medium transition-colors ${
              groupBy === "project" ? "bg-primary text-primary-foreground" : "hover:bg-muted"
            }`}
          >
            By project
          </Link>
        </div>
      </div>

      {tasks.length === 0 ? (
        <EmptyState
          icon={CheckSquare}
          title="No tasks found"
          description={filterParts.length > 0 ? "Try adjusting your filters" : "Create your first task to start tracking work"}
        />
      ) : groupBy === "project" ? (
        <ProjectGroupedTasks tasks={tasks} />
      ) : (
        <TasksListClient
          activeTasks={activeTasks}
          completedTasks={completedTasks}
          projects={projects}
          clients={clients}
          users={users}
        />
      )}
    </div>
  );
}

// ─── Grouped-by-project view ──────────────────────────────────

type TaskRow = {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: Date | null;
  completedAt: Date | null;
  project: { id: string; name: string } | null;
  client: { id: string; name: string } | null;
  assignee: { id: string; name: string } | null;
};

/**
 * Renders tasks grouped by their parent project. Each project is a card
 * containing its tasks. Tasks with no project are bundled into an
 * "Unassigned to project" group at the end. Active tasks are listed first
 * within each group, then completed tasks below.
 */
function ProjectGroupedTasks({ tasks }: { tasks: TaskRow[] }) {
  // Group tasks by project id (null for orphans)
  const groupMap = new Map<string, { name: string; projectId: string | null; tasks: TaskRow[] }>();
  for (const task of tasks) {
    const key = task.project?.id || "__none__";
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        projectId: task.project?.id || null,
        name: task.project?.name || "No project",
        tasks: [],
      });
    }
    groupMap.get(key)!.tasks.push(task);
  }

  // Sort groups: real projects alphabetically, "No project" group last
  const groups = Array.from(groupMap.values()).sort((a, b) => {
    if (a.projectId === null) return 1;
    if (b.projectId === null) return -1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="space-y-6">
      {groups.map((group) => {
        const active = group.tasks.filter(
          (t) => t.status !== "DONE" && t.status !== "CANCELLED"
        );
        const completed = group.tasks.filter(
          (t) => t.status === "DONE" || t.status === "CANCELLED"
        );

        return (
          <Card key={group.projectId || "__none__"}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold">
                  {group.projectId ? (
                    <Link
                      href={`/projects/${group.projectId}`}
                      className="hover:text-primary hover:underline"
                    >
                      {group.name}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">{group.name}</span>
                  )}
                </h3>
                <span className="text-xs text-muted-foreground">
                  {active.length} active · {completed.length} done
                </span>
              </div>

              <div className="space-y-1.5">
                {[...active, ...completed].map((task) => {
                  const isDone = task.status === "DONE" || task.status === "CANCELLED";
                  return (
                    <div
                      key={task.id}
                      className={`flex items-center gap-3 rounded border border-border/50 bg-muted p-2 ${
                        isDone ? "opacity-60" : ""
                      }`}
                    >
                      <TaskCheckbox taskId={task.id} status={task.status} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm ${isDone ? "line-through text-muted-foreground" : "font-medium"}`}>
                            {task.title}
                          </span>
                          {!isDone && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${priorityColors[task.priority]}`}>
                              {task.priority}
                            </span>
                          )}
                          {task.status === "IN_PROGRESS" && (
                            <Badge variant="default" className="text-[10px]">In Progress</Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground flex-wrap">
                          {task.client && (
                            <Link href={`/clients/${task.client.id}`} className="hover:text-primary hover:underline">
                              {task.client.name}
                            </Link>
                          )}
                          {!isDone && task.dueDate && (
                            <>
                              {task.client && <span aria-hidden className="opacity-40">·</span>}
                              <span className={new Date(task.dueDate) < new Date() ? "text-destructive font-medium" : ""}>
                                Due {formatCalendarDate(task.dueDate, "MMM d, yyyy")}
                              </span>
                            </>
                          )}
                          {isDone && (
                            <>
                              {task.client && <span aria-hidden className="opacity-40">·</span>}
                              <span>
                                Completed{task.completedAt ? ` ${formatCalendarDate(task.completedAt, "MMM d, yyyy")}` : ""}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      {task.assignee && (
                        <Link
                          href={`/team/${task.assignee.id}`}
                          className="flex items-center gap-1.5 shrink-0 hover:text-primary"
                          title={task.assignee.name}
                        >
                          <Avatar name={task.assignee.name} size="xs" />
                        </Link>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
