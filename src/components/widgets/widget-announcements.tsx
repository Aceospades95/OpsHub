import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Megaphone, Pin } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";

export async function WidgetAnnouncements({ userId: _userId }: { userId: string }) {
  const announcements = await db.intranetResource.findMany({
    where: { category: "ANNOUNCEMENT", published: true },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    take: 5,
  });

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Megaphone className="h-4 w-4" /> Announcements
        </CardTitle>
      </CardHeader>
      <CardContent>
        {announcements.length === 0 ? (
          <p className="text-sm text-muted-foreground">No announcements</p>
        ) : (
          <div className="space-y-3">
            {announcements.map((a) => (
              <Link key={a.id} href={`/intranet/${a.id}`} className="block group">
                <div className="flex items-start gap-2">
                  {a.pinned && <Pin className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium group-hover:text-primary truncate">{a.title}</p>
                    {a.description && (
                      <p className="text-xs text-muted-foreground line-clamp-1">{a.description}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatDistanceToNow(a.updatedAt, { addSuffix: true })}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
