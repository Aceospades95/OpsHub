import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";
import { differenceInDays } from "date-fns";
import { formatCalendarDate } from "@/lib/dates";
import Link from "next/link";

export async function WidgetContractAlerts({ userId: _userId }: { userId: string }) {
  const now = new Date();

  const contracts = await db.contract.findMany({
    where: {
      deletedAt: null,
      OR: [
        { status: "EXPIRING_SOON" },
        { status: "EXPIRED" },
        { endDate: { lte: new Date(now.getTime() + 30 * 86400000) }, status: "ACTIVE" },
      ],
    },
    orderBy: { endDate: "asc" },
    take: 8,
    include: { client: { select: { name: true } } },
  });

  return (
    <Card className="h-full border-warning/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2 text-warning">
          <AlertTriangle className="h-4 w-4" /> Contract Alerts
          {contracts.length > 0 && (
            <span className="bg-warning/10 text-warning text-xs px-1.5 py-0.5 rounded-full font-bold">
              {contracts.length}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {contracts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No contract alerts</p>
        ) : (
          <div className="space-y-2">
            {contracts.map((c) => {
              const daysLeft = c.endDate ? differenceInDays(c.endDate, now) : null;
              return (
                <Link key={c.id} href={`/contracts/${c.id}`} className="flex items-center gap-3 py-1 group">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate group-hover:text-primary">{c.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.client.name}
                      {c.endDate && ` · Ends ${formatCalendarDate(c.endDate, "MMM d")}`}
                    </p>
                  </div>
                  {daysLeft !== null && (
                    <span className={`text-xs font-medium shrink-0 ${daysLeft < 0 ? "text-destructive" : daysLeft < 7 ? "text-warning" : "text-muted-foreground"}`}>
                      {daysLeft < 0 ? `${Math.abs(daysLeft)}d overdue` : `${daysLeft}d left`}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
