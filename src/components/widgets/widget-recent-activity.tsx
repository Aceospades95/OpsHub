import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Activity } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface ActivityRow {
  id: string;
  user: { name: string };
  action: string;
  entityType: string;
  details: string | null;
  createdAt: Date;
}

interface CollapsedRow {
  // Stable key for the rendered row
  key: string;
  user: { name: string };
  action: string;
  entityType: string;
  details: string | null;
  createdAt: Date;
  // When >1, this row collapses N consecutive same-actor/same-action/same-entity
  // events that landed within a short window — e.g. a 50-row CSV import or a
  // bulk delete. Without this, a single import drowns out the last day of
  // activity in the 10-row widget.
  count: number;
}

const GROUP_WINDOW_MS = 5 * 60 * 1000;

function collapseBursts(rows: ActivityRow[]): CollapsedRow[] {
  const out: CollapsedRow[] = [];
  for (const row of rows) {
    const last = out[out.length - 1];
    const sameBurst =
      last &&
      last.user.name === row.user.name &&
      last.action === row.action &&
      last.entityType === row.entityType &&
      last.createdAt.getTime() - row.createdAt.getTime() <= GROUP_WINDOW_MS;
    if (sameBurst) {
      last.count += 1;
      continue;
    }
    out.push({
      key: row.id,
      user: row.user,
      action: row.action,
      entityType: row.entityType,
      details: row.details,
      createdAt: row.createdAt,
      count: 1,
    });
  }
  return out;
}

export async function WidgetRecentActivity({ userId: _userId }: { userId: string }) {
  // Pull a bigger window than we display so post-grouping we still
  // have ~10 distinct rows even when a bulk import dominates raw logs.
  const logs = await db.activityLog.findMany({
    take: 100,
    orderBy: { createdAt: "desc" },
    include: { user: { select: { name: true } } },
  });

  const grouped = collapseBursts(logs).slice(0, 10);

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Activity className="h-4 w-4" /> Recent Activity
        </CardTitle>
      </CardHeader>
      <CardContent>
        {grouped.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recent activity</p>
        ) : (
          <div className="space-y-2.5">
            {grouped.map((log) => (
              <div key={log.key} className="flex items-start gap-2">
                <Avatar name={log.user.name} size="xs" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm">
                    <span className="font-medium">{log.user.name}</span>{" "}
                    <span className="text-muted-foreground">{log.action}</span>{" "}
                    <span className="text-muted-foreground">
                      {log.count > 1 ? `${log.count} ${log.entityType}s` : log.entityType}
                    </span>
                    {log.count === 1 && log.details && (
                      <span className="text-muted-foreground"> — {log.details}</span>
                    )}
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
