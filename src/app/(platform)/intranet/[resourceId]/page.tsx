import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { db } from "@/lib/db";
import { resolveModulePerms } from "@/lib/permissions";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Pin } from "lucide-react";
import { IntranetActions } from "./intranet-actions";
import { IntranetAttachments } from "./intranet-attachments";
import { PageLayout } from "@/components/shared/page-layout";

interface Props {
  params: Promise<{ resourceId: string }>;
}

export default async function IntranetDetailPage({ params }: Props) {
  const { resourceId } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");

  const perms = await resolveModulePerms(session.user.id, session.user.role, "intranet");
  if (!perms.canView) redirect("/dashboard");

  const resource = await db.intranetResource.findUnique({
    where: { id: resourceId },
    include: { links: true, embeds: true },
  });

  if (!resource) notFound();

  const canEditLayout = session.user.role === "ADMIN" || session.user.role === "DEVELOPER";

  const cardMap: Record<string, React.ReactNode> = {
    content: resource.content ? (
      <Card className="h-full">
        <CardHeader><CardTitle>Content</CardTitle></CardHeader>
        <CardContent>
          <div className="text-sm whitespace-pre-wrap">{resource.content}</div>
        </CardContent>
      </Card>
    ) : (
      <Card className="h-full">
        <CardHeader><CardTitle>Content</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No content yet</p>
        </CardContent>
      </Card>
    ),
    attachments: (
      <Card className="h-full">
        <CardHeader><CardTitle>Attachments</CardTitle></CardHeader>
        <CardContent>
          <IntranetAttachments
            resourceId={resource.id}
            links={resource.links}
            embeds={resource.embeds}
            canEdit={perms.canEdit}
            canDelete={perms.canDelete}
          />
        </CardContent>
      </Card>
    ),
  };

  return (
    <div>
      <PageHeader
        title={resource.title}
        description={resource.description || undefined}
        actions={<IntranetActions resource={resource} canEdit={perms.canEdit} canDelete={perms.canDelete} />}
      />

      <div className="flex items-center gap-3 mb-6">
        <Badge variant="outline">{resource.category.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c: string) => c.toUpperCase())}</Badge>
        {resource.published ? <Badge variant="success">Published</Badge> : <Badge variant="secondary">Draft</Badge>}
        {resource.pinned && (
          <Badge variant="default" className="flex items-center gap-1">
            <Pin className="h-3 w-3" /> Pinned
          </Badge>
        )}
      </div>

      <PageLayout pageType="intranet-detail" cards={cardMap} canEdit={canEditLayout} mode="flow" />
    </div>
  );
}
