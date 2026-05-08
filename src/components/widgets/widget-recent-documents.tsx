import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Files } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";

export async function WidgetRecentDocuments({ userId: _userId }: { userId: string }) {
  const documents = await db.document.findMany({
    where: { deletedAt: null },
    orderBy: { updatedAt: "desc" },
    take: 6,
    include: { project: { select: { id: true, name: true } } },
  });

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Files className="h-4 w-4" /> Recent Documents
        </CardTitle>
      </CardHeader>
      <CardContent>
        {documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">No documents yet</p>
        ) : (
          <div className="space-y-2">
            {documents.map((doc) => (
              <Link
                key={doc.id}
                href={`/projects/${doc.projectId}/documents/${doc.id}`}
                className="flex items-center gap-3 py-1 group"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate group-hover:text-primary">{doc.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {doc.project?.name || "No project"} · v{doc.version} · {formatDistanceToNow(doc.updatedAt, { addSuffix: true })}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
