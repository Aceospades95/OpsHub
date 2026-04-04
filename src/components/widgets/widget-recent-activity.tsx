import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Activity } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export async function WidgetRecentActivity({ userId: _userId }: { userId: string }) {
  const logs = await db.activityLog.findMany({
    take: 10,
    orderBy: { createdAt: "desc" },
    include: { user: { select: { name: true } } },
  });

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Activity className="h-4 w-4" /> Recent Activity
        </CardTitle>
      </CardHeader>
      <CardContent>
        {logs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recent activity</p>
        ) : (
          <div className="space-y-2.5">
            {logs.map((log) => (
              <div key={log.id} className="flex items-start gap-2">
                <Avatar name={log.user.name} size="xs" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm">
                    <span className="font-medium">{log.user.name}</span>{" "}
                    <span className="text-muted-foreground">{log.action}</span>{" "}
                    <span className="text-muted-foreground">{log.entityType}</span>
                    {log.details && <span className="text-muted-foreground"> — {log.details}</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDistanceToNow(log.createdAt, { addSuffix: true })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
