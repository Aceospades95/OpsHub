import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CommentSection } from "@/components/shared/comment-section";
import { format } from "date-fns";
import Link from "next/link";
import { DocumentActions } from "./document-actions";
import { VersionHistory } from "./version-history";

interface Props {
  params: Promise<{ projectId: string; documentId: string }>;
}

export default async function DocumentDetailPage({ params }: Props) {
  const { projectId, documentId } = await params;
  const user = await requireAuth();

  const perms = await resolveModulePerms(user.id, user.role, "projects");
  if (!perms.canView) return <AccessDenied module="projects" moduleLabel="Projects" moduleDescription="Project portfolio, milestones, staffing, and documents" />;

  const document = await db.document.findFirst({
    where: { id: documentId, deletedAt: null },
    include: {
      versions: { orderBy: { version: "desc" } },
      comments: {
        include: { author: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!document) notFound();

  return (
    <div>
      <PageHeader
        title={document.title}
        actions={
          <DocumentActions
            document={document}
            projectId={projectId}
            canEdit={perms.canEdit}
            canDelete={perms.canDelete}
          />
        }
      />

      <div className="mb-4 text-sm text-muted-foreground">
        <Link href={`/projects/${projectId}`} className="hover:text-primary">
          ← Back to project
        </Link>
      </div>

      <div className="flex items-center gap-3 mb-6">
        <Badge variant="outline">{document.type}</Badge>
        <span className="text-sm text-muted-foreground">Version {document.version}</span>
        {document.published ? (
          <Badge variant="success">Published</Badge>
        ) : (
          <Badge variant="secondary">Draft</Badge>
        )}
        <span className="text-xs text-muted-foreground">
          Updated {format(document.updatedAt, "MMM d, yyyy 'at' h:mm a")}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Content</CardTitle>
            </CardHeader>
            <CardContent>
              {document.content ? (
                <div className="prose max-w-none text-sm whitespace-pre-wrap">
                  {document.content}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No content</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Comments</CardTitle>
            </CardHeader>
            <CardContent>
              <CommentSection
                comments={document.comments}
                entityType="document"
                entityId={document.id}
                canComment={perms.canComment}
                canDelete={perms.canDelete}
                currentUserId={user.id}
              />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Version History ({document.versions.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <VersionHistory
                versions={document.versions}
                documentId={document.id}
                canEdit={perms.canEdit}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
