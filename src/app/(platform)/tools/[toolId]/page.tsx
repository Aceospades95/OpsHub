import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { getUserScope, canViewEntity } from "@/lib/scope";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileList } from "@/components/shared/file-list";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { ToolActions } from "./tool-actions";
import { ToolProjectsSection } from "./tool-projects";
import { ToolEmbedsSection } from "./tool-embeds";

interface Props {
  params: Promise<{ toolId: string }>;
}

export default async function ToolDetailPage({ params }: Props) {
  const { toolId } = await params;
  const user = await requireAuth();

  const perms = await resolveModulePerms(user.id, user.role, "tools");
  if (!perms.canView) return <AccessDenied module="tools" moduleLabel="Tools" moduleDescription="Shared tools and linked resources" />;

  const tool = await db.tool.findUnique({
    where: { id: toolId },
    include: {
      clonedFrom: { select: { id: true, name: true } },
      clones: { select: { id: true, name: true } },
      embeds: true,
      projects: { include: { project: { select: { id: true, name: true } } } },
    },
  });

  if (!tool) notFound();

  const scope = await getUserScope(user.id, user.role);
  if (!canViewEntity(scope, "tool", tool.id)) {
    return <AccessDenied module="tools" moduleLabel="Tools" entityType="tool" entityId={tool.id} entityLabel={tool.name} />;
  }

  const allProjects = await db.project.findMany({
    where: scope.all ? {} : { id: { in: Array.from(scope.projectIds) } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <div>
      <PageHeader
        title={tool.name}
        description={tool.description || undefined}
        actions={<ToolActions tool={tool} canEdit={perms.canEdit} canDelete={perms.canDelete} canCreate={perms.canCreate} />}
      />

      <div className="flex items-center gap-3 mb-6">
        <Badge variant="outline">{tool.toolType}</Badge>
        {tool.category && <Badge variant="secondary">{tool.category}</Badge>}
        {tool.isGlobal && <Badge variant="success">Global</Badge>}
      </div>

      {tool.toolUrl && (
        <a
          href={tool.toolUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline mb-6"
        >
          <ExternalLink className="h-3 w-3" /> Open Tool
        </a>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader><CardTitle>Embeds</CardTitle></CardHeader>
            <CardContent>
              <ToolEmbedsSection
                embeds={tool.embeds}
                toolId={tool.id}
                canEdit={perms.canEdit}
                canDelete={perms.canDelete}
              />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Assigned Projects ({tool.projects.length})</CardTitle></CardHeader>
            <CardContent>
              <ToolProjectsSection
                toolProjects={tool.projects}
                toolId={tool.id}
                allProjects={allProjects}
                canEdit={perms.canEdit}
              />
            </CardContent>
          </Card>

          {tool.clonedFrom && (
            <Card>
              <CardHeader><CardTitle>Cloned From</CardTitle></CardHeader>
              <CardContent>
                <Link href={`/tools/${tool.clonedFrom.id}`} className="text-sm text-primary hover:underline">
                  {tool.clonedFrom.name}
                </Link>
              </CardContent>
            </Card>
          )}

          {tool.clones.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Clones ({tool.clones.length})</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-1">
                  {tool.clones.map((clone) => (
                    <Link key={clone.id} href={`/tools/${clone.id}`} className="block text-sm text-primary hover:underline">
                      {clone.name}
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
