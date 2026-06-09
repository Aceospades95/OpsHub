import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Pin } from "lucide-react";
import { IntranetActions } from "./intranet-actions";
import { IntranetAttachments } from "./intranet-attachments";
import { PageLayout } from "@/components/shared/page-layout";
import { Markdown } from "@/components/shared/markdown";

interface Props {
  params: Promise<{ resourceId: string }>;
}

export default async function IntranetDetailPage({ params }: Props) {
  const { resourceId } = await params;
  const user = await requireAuth();

  const perms = await resolveModulePerms(user.id, user.role, "intranet");

  // Round-8 QA: resolve by slug-or-id (slug is the canonical href
  // for new records; cuid still works for old bookmarks).
  // Drafts are only visible to users who can edit — mirrors the
  // published filter on the /intranet list page.
  const resource = await db.intranetResource.findFirst({
    where: {
      OR: [{ id: resourceId }, { slug: resourceId }],
      deletedAt: null,
      ...(perms.canEdit ? {} : { published: true }),
    },
    include: { links: true, embeds: true },
  });

  if (!resource) notFound();

  const canEditLayout = user.role === "ADMIN" || user.role === "DEVELOPER";

  const cardMap: Record<string, React.ReactNode> = {
    content: resource.content ? (
      <Card className="h-full">
        <CardHeader><CardTitle>Content</CardTitle></CardHeader>
        <CardContent>
          <Markdown source={resource.content} />
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

      {/* Round-8 QA: the page-type-level layout customization put a
       *  Team Directory widget on every intranet detail page, which
       *  read as noise on announcements (and presumably on most
       *  category-style content). Suppress the widget for category
       *  types where the directory has no obvious connection. Org
       *  Chart and SOP keep the widget; everything else hides it. */}
      <PageLayout
        pageType="intranet-detail"
        cards={cardMap}
        canEdit={canEditLayout}
        mode="flow"
        hideWidgetIds={
          resource.category === "ORG_CHART" || resource.category === "SOP"
            ? undefined
            : ["widget-team-directory"]
        }
      />
    </div>
  );
}
