import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { History } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

// Human-readable labels for the action verbs we log.
const ACTION_LABELS: Record<string, string> = {
  created: "created the certification",
  updated: "updated the certification",
  deleted: "deleted the certification",
  commented: "commented",
  imported: "imported the certification",
  "signed-off": "signed off the certification",
  "sign-off-revoked": "revoked the sign-off",
  "checklist-added": "added a checklist item",
  "checklist-toggled": "toggled a checklist item",
  "checklist-removed": "removed a checklist item",
};

interface Props {
  certId: string;
  limit?: number;
}

export async function AuditTrailCard({ certId, limit = 20 }: Props) {
  const logs = await db.activityLog.findMany({
    where: { entityType: "certification", entityId: certId },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { user: { select: { id: true, name: true } } },
  });

  return (
    <Card className="h-full overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2">
          <History className="h-4 w-4" />
          Audit Trail
        </CardTitle>
      </CardHeader>
      <CardContent className="overflow-y-auto">
        {logs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
        ) : (
          <ol className="space-y-3">
            {logs.map((log) => (
              <li key={log.id} className="flex items-start gap-2.5">
                <Avatar name={log.user.name} size="xs" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm leading-snug">
                    <span className="font-medium">{log.user.name}</span>{" "}
                    <span className="text-muted-foreground">
                      {ACTION_LABELS[log.action] || log.action}
                    </span>
                    {log.details && (
                      <span className="text-muted-foreground"> — {log.details}</span>
                    )}
                  </p>
                  <p
                    className="text-xs text-muted-foreground"
                    title={format(log.createdAt, "PPpp")}
                  >
                    {formatDistanceToNow(log.createdAt, { addSuffix: true })}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
        {logs.length >= limit && (
          <p className="text-xs text-muted-foreground mt-3 italic">
            Showing the most recent {limit} events.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
