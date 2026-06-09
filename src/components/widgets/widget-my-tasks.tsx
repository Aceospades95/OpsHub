import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { CheckSquare, Clock } from "lucide-react";
import { formatCalendarDate } from "@/lib/dates";
import Link from "next/link";

export async function WidgetMyTasks({ userId }: { userId: string }) {
  const tasks = await db.task.findMany({
    where: { assigneeId: userId, status: { in: ["TODO", "IN_PROGRESS"] }, deletedAt: null },
    orderBy: [{ priority: "asc" }, { dueDate: "asc" }],
    take: 8,
    include: {
      project: { select: { id: true, name: true } },
      client: { select: { id: true, name: true } },
    },
  });

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <CheckSquare className="h-4 w-4" /> My Tasks
          </CardTitle>
          <Link href="/tasks" className="text-xs text-primary hover:underline">View all</Link>
        </div>
      </CardHeader>
      <CardContent>
        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open tasks assigned to you</p>
        ) : (
          <div className="space-y-2">
            {tasks.map((task) => (
              <div key={task.id} className="flex items-center gap-2 py-1">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{task.title}</span>
                    <StatusBadge status={task.priority} />
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {task.project && (
                      <Link href={`/projects/${task.project.id}`} className="hover:text-primary hover:underline">
                        {task.project.name}
                      </Link>
                    )}
                    {task.dueDate && (
                      <span className={`flex items-center gap-1 ${new Date(task.dueDate) < new Date() ? "text-destructive" : ""}`}>
                        <Clock className="h-3 w-3" /> {formatCalendarDate(task.dueDate, "MMM d")}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
