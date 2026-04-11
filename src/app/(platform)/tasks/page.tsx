import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { CheckSquare } from "lucide-react";
import { TaskCreateButton } from "./task-create-button";
import { TaskCheckbox } from "./task-checkbox";
import { TaskFilters } from "./task-filters";
import { Suspense } from "react";
import { format } from "date-fns";
import Link from "next/link";
import type { Prisma } from "@prisma/client";

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

export default async function TasksPage({
  searchParams,
}: {
  searchParams: { assignee?: string; project?: string; client?: string; show?: string };
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { assignee, project, client, show } = searchParams;

  // Build filter
  const where: Prisma.TaskWhereInput = {};

  if (assignee === "me") {
    where.assigneeId = session.user.id;
  } else if (assignee === "unassigned") {
    where.assigneeId = null;
  } else if (assignee && assignee !== "all") {
    where.assigneeId = assignee;
  }

  if (project) {
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

  const [tasks, projects, clients, users] = await Promise.all([
    db.task.findMany({
      where,
      orderBy: [{ status: "asc" }, { priority: "asc" }, { dueDate: "asc" }],
      include: {
        project: { select: { id: true, name: true } },
        client: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true } },
        createdBy: { select: { name: true } },
      },
    }),
    db.project.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.client.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
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
        actions={<TaskCreateButton projects={projects} clients={clients} users={users} />}
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
          currentUserId={session.user.id}
        />
      </Suspense>

      <p className="text-xs text-muted-foreground mb-4">{filterLabel} — {tasks.length} task{tasks.length !== 1 ? "s" : ""}</p>

      {tasks.length === 0 ? (
        <EmptyState
          icon={CheckSquare}
          title="No tasks found"
          description={filterParts.length > 0 ? "Try adjusting your filters" : "Create your first task to start tracking work"}
        />
      ) : (
        <div className="space-y-8">
          {activeTasks.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-foreground mb-4">
                Active ({activeTasks.length})
              </h2>
              <div className="space-y-2">
                {activeTasks.map((task) => (
                  <Card key={task.id} className="hover:shadow-sm transition-shadow">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-4">
                        <TaskCheckbox taskId={task.id} status={task.status} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-foreground">{task.title}</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${priorityColors[task.priority]}`}>
                              {task.priority}
                            </span>
                            {task.status === "IN_PROGRESS" && (
                              <Badge variant="default" className="text-xs">In Progress</Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                            {task.project && (
                              <Link href={`/projects/${task.project.id}`} className="hover:text-primary">
                                {task.project.name}
                              </Link>
                            )}
                            {task.client && (
                              <Link href={`/clients/${task.client.id}`} className="hover:text-primary">
                                {task.client.name}
                              </Link>
                            )}
                            {task.dueDate && (
                              <span className={new Date(task.dueDate) < new Date() ? "text-destructive font-medium" : ""}>
                                Due {format(new Date(task.dueDate), "MMM d, yyyy")}
                              </span>
                            )}
                          </div>
                        </div>
                        {task.assignee && (
                          <Link
                            href={`/team/${task.assignee.id}`}
                            className="flex items-center gap-1.5 shrink-0 hover:text-primary"
                          >
                            <Avatar name={task.assignee.name} size="xs" />
                            <span className="text-xs text-muted-foreground hover:text-primary hidden sm:inline">{task.assignee.name}</span>
                          </Link>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {completedTasks.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-muted-foreground mb-4">
                Completed ({completedTasks.length})
              </h2>
              <div className="space-y-2 opacity-60">
                {completedTasks.map((task) => (
                  <Card key={task.id}>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-4">
                        <TaskCheckbox taskId={task.id} status={task.status} />
                        <div className="flex-1 min-w-0">
                          <span className="font-medium text-foreground line-through">{task.title}</span>
                          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                            {task.project && <span>{task.project.name}</span>}
                            {task.client && <span>{task.client.name}</span>}
                            {task.assignee && (
                              <Link href={`/team/${task.assignee.id}`} className="hover:text-primary hover:underline">
                                {task.assignee.name}
                              </Link>
                            )}
                            <span>{statusLabels[task.status]}</span>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
