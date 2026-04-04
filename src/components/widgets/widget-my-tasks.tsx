import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckSquare, Clock } from "lucide-react";
import { format } from "date-fns";
import Link from "next/link";

export async function WidgetMyTasks({ userId }: { userId: string }) {
  const tasks = await db.task.findMany({
    where: { assigneeId: userId, status: { in: ["TODO", "IN_PROGRESS"] } },
    orderBy: [{ priority: "asc" }, { dueDate: "asc" }],
    take: 8,
    include: {
      project: { select: { name: true } },
      client: { select: { name: true } },
    },
  });

  const priorityColors: Record<string, string> = {
    HIGH: "bg-red-100 text-red-800",
    MEDIUM: "bg-yellow-100 text-yellow-800",
    LOW: "bg-green-100 text-green-800",
  };

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
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${priorityColors[task.priority]}`}>
                      {task.priority}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {task.project && <span>{task.project.name}</span>}
                    {task.dueDate && (
                      <span className={`flex items-center gap-1 ${new Date(task.dueDate) < new Date() ? "text-destructive" : ""}`}>
                        <Clock className="h-3 w-3" /> {format(new Date(task.dueDate), "MMM d")}
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
