import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { getUserScope } from "@/lib/scope";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Wrench } from "lucide-react";
import Link from "next/link";
import { ToolCreateButton } from "./tool-create-button";
import { DownloadCsvButton } from "@/components/shared/download-csv-button";
import type { Prisma } from "@prisma/client";
import { pluralize } from "@/lib/pluralize";

export default async function ToolsPage() {
  const user = await requireAuth();

  const perms = await resolveModulePerms(user.id, user.role, "tools");
  if (!perms.canView) return <AccessDenied module="tools" moduleLabel="Tools" moduleDescription="Shared tools and linked resources" />;

  const scope = await getUserScope(user.id, user.role);
  const toolWhere: Prisma.ToolWhereInput = { deletedAt: null, isGlobal: true };
  if (!scope.all) {
    toolWhere.id = { in: Array.from(scope.toolIds) };
  }

  const tools = await db.tool.findMany({
    where: toolWhere,
    orderBy: { name: "asc" },
    include: {
      _count: {
        select: {
          clones: { where: { deletedAt: null } },
          projects: { where: { project: { deletedAt: null } } },
        },
      },
      projects: {
        where: { project: { deletedAt: null } },
        include: { project: { select: { id: true, name: true } } },
      },
    },
  });

  return (
    <div>
      <PageHeader
        title="Tools"
        description="Company tools, forms, and calculators"
        actions={
          <div className="flex items-center gap-2">
            {user.role === "ADMIN" && <DownloadCsvButton importerKey="tools" />}
            {perms.canCreate && <ToolCreateButton />}
          </div>
        }
      />

      {tools.length === 0 ? (
        <EmptyState icon={Wrench} title="No tools yet" description="Create your first tool" />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tools.map((tool) => (
            <Link key={tool.id} href={`/tools/${tool.id}`}>
              <Card className="hover:shadow-md transition-shadow h-full">
                <CardContent className="p-5">
                  <h3 className="font-semibold text-foreground mb-1">{tool.name}</h3>
                  {tool.description && (
                    <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{tool.description}</p>
                  )}
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline">{tool.toolType}</Badge>
                    {tool.category && <Badge variant="secondary">{tool.category}</Badge>}
                    {tool._count.clones > 0 && (
                      <span className="text-xs text-muted-foreground">{pluralize(tool._count.clones, "clone")}</span>
                    )}
                    {tool._count.projects > 0 && (
                      <span className="text-xs text-muted-foreground">{pluralize(tool._count.projects, "project")}</span>
                    )}
                  </div>
                  {tool.projects.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {tool.projects.map((pt) => (
                        <Badge key={pt.id} variant="outline" className="text-xs">
                          {pt.project.name}
                        </Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
