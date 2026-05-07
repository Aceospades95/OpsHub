import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Users } from "lucide-react";

export async function WidgetTeamDirectory({ userId: _userId }: { userId: string }) {
  // Round-4 QA: hide login-less placeholder users (synthetic rows
  // created during merges, etc.) so the directory reflects actual
  // team members rather than internal bookkeeping records.
  const members = await db.user.findMany({
    where: { isActive: true, hasLoginAccess: true },
    orderBy: { name: "asc" },
    take: 10,
    select: { id: true, name: true, role: true, jobTitle: true, department: true },
  });

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Users className="h-4 w-4" /> Team Directory
        </CardTitle>
      </CardHeader>
      <CardContent>
        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground">No team members</p>
        ) : (
          <div className="space-y-2">
            {members.map((m) => {
              // Only fall back to role text when there's no
              // jobTitle / department to show. Otherwise the row
              // renders the role twice (once as subtitle, once as
              // the trailing Badge), e.g. "ADMIN ADMIN".
              const subtitle = m.jobTitle || m.department || null;
              return (
                <div key={m.id} className="flex items-center gap-3 py-1">
                  <Avatar name={m.name} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{m.name}</p>
                    {subtitle && (
                      <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
                    )}
                  </div>
                  <Badge variant="outline" className="text-[10px] shrink-0">{m.role}</Badge>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
