import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Kanban } from "lucide-react";
import Link from "next/link";

const statusConfig: { status: string; label: string; color: string; bg: string }[] = [
  { status: "PLANNING", label: "Planning", color: "text-blue-700", bg: "bg-blue-50" },
  { status: "ACTIVE", label: "Active", color: "text-green-700", bg: "bg-green-50" },
  { status: "ON_HOLD", label: "On Hold", color: "text-yellow-700", bg: "bg-yellow-50" },
  { status: "COMPLETED", label: "Completed", color: "text-gray-700", bg: "bg-gray-50" },
];

export async function WidgetProjectStatus({ userId: _userId }: { userId: string }) {
  const projects = await db.project.findMany({
    where: { status: { in: ["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED"] } },
    select: { id: true, name: true, status: true, client: { select: { name: true } } },
    orderBy: { updatedAt: "desc" },
    take: 20,
  });

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Kanban className="h-4 w-4" /> Project Status Board
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {statusConfig.map((sc) => {
            const items = projects.filter((p) => p.status === sc.status);
            return (
              <div key={sc.status}>
                <div className={`px-2 py-1 rounded-t-md text-xs font-semibold ${sc.color} ${sc.bg}`}>
                  {sc.label} ({items.length})
                </div>
                <div className="border border-t-0 border-border rounded-b-md p-1 space-y-1 min-h-[60px]">
                  {items.slice(0, 5).map((p) => (
                    <Link key={p.id} href={`/projects/${p.id}`} className="block px-2 py-1 text-xs rounded hover:bg-muted truncate">
                      {p.name}
                    </Link>
                  ))}
                  {items.length > 5 && (
                    <p className="px-2 text-[10px] text-muted-foreground">+{items.length - 5} more</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
