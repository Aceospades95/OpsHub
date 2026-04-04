import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FolderKanban } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";

const statusColors: Record<string, string> = {
  PLANNING: "secondary",
  ACTIVE: "success",
  ON_HOLD: "warning",
  COMPLETED: "default",
  ARCHIVED: "outline",
};

export async function WidgetRecentProjects({ userId: _userId }: { userId: string }) {
  const projects = await db.project.findMany({
    orderBy: { updatedAt: "desc" },
    take: 6,
    include: { client: { select: { name: true } } },
  });

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <FolderKanban className="h-4 w-4" /> Recent Projects
          </CardTitle>
          <Link href="/projects" className="text-xs text-primary hover:underline">View all</Link>
        </div>
      </CardHeader>
      <CardContent>
        {projects.length === 0 ? (
          <p className="text-sm text-muted-foreground">No projects yet</p>
        ) : (
          <div className="space-y-2">
            {projects.map((p) => (
              <Link key={p.id} href={`/projects/${p.id}`} className="flex items-center gap-3 py-1 group">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate group-hover:text-primary">{p.name}</p>
                  <p className="text-xs text-muted-foreground">{p.client.name} · {formatDistanceToNow(p.updatedAt, { addSuffix: true })}</p>
                </div>
                <Badge variant={(statusColors[p.status] || "outline") as "default" | "secondary" | "outline" | "destructive" | "success" | "warning"}>{p.status}</Badge>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
