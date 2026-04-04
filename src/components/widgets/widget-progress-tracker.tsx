import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3 } from "lucide-react";

export async function WidgetProgressTracker({ userId: _userId }: { userId: string }) {
  const [totalTasks, doneTasks, totalMilestones, completedMilestones, totalProjects, completedProjects] =
    await Promise.all([
      db.task.count(),
      db.task.count({ where: { status: "DONE" } }),
      db.milestone.count(),
      db.milestone.count({ where: { completed: true } }),
      db.project.count(),
      db.project.count({ where: { status: "COMPLETED" } }),
    ]);

  const items = [
    { label: "Tasks Completed", done: doneTasks, total: totalTasks },
    { label: "Milestones Hit", done: completedMilestones, total: totalMilestones },
    { label: "Projects Delivered", done: completedProjects, total: totalProjects },
  ];

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <BarChart3 className="h-4 w-4" /> Progress Tracker
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {items.map((item) => {
          const pct = item.total > 0 ? Math.round((item.done / item.total) * 100) : 0;
          return (
            <div key={item.label}>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-muted-foreground">{item.label}</span>
                <span className="font-medium">{item.done}/{item.total}</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
