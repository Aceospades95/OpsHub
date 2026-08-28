import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText } from "lucide-react";
import { formatCalendarDate } from "@/lib/dates";
import { effectiveContractStatus } from "@/lib/effective-status";
import Link from "next/link";

export async function WidgetRecentContracts({ userId: _userId }: { userId: string }) {
  const contracts = await db.contract.findMany({
    where: { deletedAt: null },
    orderBy: { updatedAt: "desc" },
    take: 6,
    include: { client: { select: { name: true } } },
  });
  const now = new Date();

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="h-4 w-4" /> Recent Contracts
          </CardTitle>
          <Link href="/contracts" className="text-xs text-primary hover:underline">View all</Link>
        </div>
      </CardHeader>
      <CardContent>
        {contracts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No contracts yet</p>
        ) : (
          <div className="space-y-2">
            {contracts.map((c) => {
              // Date-derived, same as the contracts pages — the stored
              // enum lags the calendar between expiry-job runs.
              const status = effectiveContractStatus(c, now);
              return (
                <Link key={c.id} href={`/contracts/${c.id}`} className="flex items-center gap-3 py-1 group">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate group-hover:text-primary">{c.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.client.name}
                      {c.endDate && ` · Ends ${formatCalendarDate(c.endDate, "MMM d, yyyy")}`}
                    </p>
                  </div>
                  <Badge variant={status === "ACTIVE" ? "success" : status === "EXPIRED" ? "destructive" : "outline"} className="text-[10px]">
                    {status}
                  </Badge>
                </Link>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
