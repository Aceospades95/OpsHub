import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar, Clock } from "lucide-react";
import { addDays } from "date-fns";
import { formatCalendarDate } from "@/lib/dates";

export async function WidgetCalendar({ userId: _userId }: { userId: string }) {
  const now = new Date();
  const thirtyDays = addDays(now, 30);

  const [upcomingTasks, upcomingMilestones, expiringContracts] = await Promise.all([
    db.task.findMany({
      where: { dueDate: { gte: now, lte: thirtyDays }, status: { in: ["TODO", "IN_PROGRESS"] } },
      orderBy: { dueDate: "asc" },
      take: 5,
      select: { id: true, title: true, dueDate: true },
    }),
    db.milestone.findMany({
      where: { dueDate: { gte: now, lte: thirtyDays }, completed: false },
      orderBy: { dueDate: "asc" },
      take: 5,
      select: { id: true, title: true, dueDate: true },
    }),
    db.contract.findMany({
      where: { endDate: { gte: now, lte: thirtyDays }, status: "ACTIVE" },
      orderBy: { endDate: "asc" },
      take: 5,
      select: { id: true, title: true, endDate: true },
    }),
  ]);

  type EventItem = { id: string; title: string; date: Date; type: string; color: string };
  const events: EventItem[] = [
    ...upcomingTasks.filter((t) => t.dueDate).map((t) => ({
      id: t.id, title: t.title, date: t.dueDate!, type: "Task", color: "text-blue-600",
    })),
    ...upcomingMilestones.filter((m) => m.dueDate).map((m) => ({
      id: m.id, title: m.title, date: m.dueDate!, type: "Milestone", color: "text-purple-600",
    })),
    ...expiringContracts.filter((c) => c.endDate).map((c) => ({
      id: c.id, title: c.title, date: c.endDate!, type: "Contract", color: "text-orange-600",
    })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime()).slice(0, 10);

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Calendar className="h-4 w-4" /> Upcoming (30 days)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing upcoming</p>
        ) : (
          <div className="space-y-2">
            {events.map((e) => (
              <div key={`${e.type}-${e.id}`} className="flex items-center gap-3 py-1">
                <div className="text-center w-10 shrink-0">
                  <div className="text-xs text-muted-foreground">{formatCalendarDate(e.date, "MMM")}</div>
                  <div className="text-lg font-bold leading-tight">{formatCalendarDate(e.date, "d")}</div>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{e.title}</p>
                  <p className={`text-xs ${e.color}`}>{e.type}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
