import { db } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { Building2, FolderKanban, FileText, CheckSquare, Users } from "lucide-react";

export async function WidgetStatsSummary({ userId: _userId }: { userId: string }) {
  const [clients, projects, contracts, tasks, team] = await Promise.all([
    db.client.count({ where: { status: "ACTIVE", deletedAt: null } }),
    db.project.count({ where: { status: "ACTIVE", deletedAt: null } }),
    db.contract.count({ where: { status: "ACTIVE", deletedAt: null } }),
    db.task.count({ where: { status: { in: ["TODO", "IN_PROGRESS"] }, deletedAt: null } }),
    db.user.count({ where: { isActive: true } }),
  ]);

  const stats = [
    { label: "Clients", value: clients, icon: Building2 },
    { label: "Projects", value: projects, icon: FolderKanban },
    { label: "Contracts", value: contracts, icon: FileText },
    { label: "Tasks", value: tasks, icon: CheckSquare },
    { label: "Team", value: team, icon: Users },
  ];

  return (
    <Card className="h-full">
      <CardContent className="p-4 h-full flex items-center">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 w-full">
          {stats.map((s) => {
            const Icon = s.icon;
            return (
              <div key={s.label} className="text-center">
                <Icon className="h-5 w-5 text-primary/60 mx-auto mb-1" />
                <div className="text-2xl font-bold">{s.value}</div>
                <div className="text-xs text-muted-foreground">{s.label}</div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
