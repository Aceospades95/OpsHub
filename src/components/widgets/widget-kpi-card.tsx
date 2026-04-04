import { db } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, Building2, FolderKanban, CheckSquare } from "lucide-react";

export async function WidgetKpiCard({ userId: _userId }: { userId: string }) {
  const [clients, projects, tasks] = await Promise.all([
    db.client.count(),
    db.project.count({ where: { status: "ACTIVE" } }),
    db.task.count({ where: { status: { in: ["TODO", "IN_PROGRESS"] } } }),
  ]);

  return (
    <Card className="h-full">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Key Metrics</span>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground flex items-center gap-2">
              <Building2 className="h-3.5 w-3.5" /> Clients
            </span>
            <span className="text-lg font-bold">{clients}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground flex items-center gap-2">
              <FolderKanban className="h-3.5 w-3.5" /> Active Projects
            </span>
            <span className="text-lg font-bold">{projects}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground flex items-center gap-2">
              <CheckSquare className="h-3.5 w-3.5" /> Open Tasks
            </span>
            <span className="text-lg font-bold">{tasks}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
