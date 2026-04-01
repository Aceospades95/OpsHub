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
import { format } from "date-fns";
import Link from "next/link";

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

export default async function TasksPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [tasks, projects, clients, users] = await Promise.all([
    db.task.findMany({
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

  return (
    <div>
      <PageHeader
        title="Tasks"
        description="Track and manage tasks across projects and clients"
        actions={<TaskCreateButton projects={projects} clients={clients} users={users} />}
      />

      {tasks.length === 0 ? (
        <EmptyState
          icon={CheckSquare}
          title="No tasks yet"
          description="Create your first task to start tracking work"
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
                          <Avatar name={task.assignee.name} size="xs" />
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
