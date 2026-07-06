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
import { ViewOptionsBar } from "@/components/shared/view-options-bar";
import { GroupSection } from "@/components/shared/group-section";
import { groupRows } from "@/lib/group-rows";

const GROUP_OPTIONS = [
  { value: "category", label: "Category" },
  { value: "toolType", label: "Tool type" },
] as const;
type GroupKey = (typeof GROUP_OPTIONS)[number]["value"];

export const metadata = { title: "Tools · OpsHub" };

export default async function ToolsPage({
  searchParams,
}: {
  searchParams: { view?: string; groupBy?: string };
}) {
  const user = await requireAuth();

  const perms = await resolveModulePerms(user.id, user.role, "tools");
  if (!perms.canView) return <AccessDenied module="tools" moduleLabel="Tools" moduleDescription="Shared tools and linked resources" />;

  const scope = await getUserScope(user.id, user.role);
  const toolWhere: Prisma.ToolWhereInput = { deletedAt: null, isGlobal: true };
  if (!scope.all) {
    toolWhere.id = { in: Array.from(scope.toolIds) };
  }

  const view = searchParams.view === "table" ? "table" : "cards";
  const groupBy = GROUP_OPTIONS.some((o) => o.value === searchParams.groupBy)
    ? (searchParams.groupBy as GroupKey)
    : null;

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

  type ToolRow = (typeof tools)[number];
  const groupKeyOf = (tool: ToolRow, key: GroupKey): string | null => {
    switch (key) {
      case "category":
        return tool.category;
      case "toolType":
        return tool.toolType;
    }
  };

  const renderCards = (rows: ToolRow[]) => (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((tool) => (
        <Link key={tool.id} href={`/tools/${tool.id}`}>
          <Card className="hover:shadow-md transition-shadow h-full">
            <CardContent className="p-5">
              <h3 className="font-semibold text-foreground mb-1">{tool.name}</h3>
              {tool.description && (
                <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{tool.description}</p>
              )}
              {/* Tag row first — uniform Badge styling so they
               *  read as a single visual group. The QA-flagged
               *  inconsistency was a mix of badges and bare text
               *  spans here; everything is a Badge now. */}
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline">{tool.toolType}</Badge>
                {tool.category && <Badge variant="secondary">{tool.category}</Badge>}
              </div>
              {/* Counts moved to a separate sub-row so the inline
               *  "Used by 1 project" no longer crowds the tags. */}
              {(tool._count.clones > 0 || tool._count.projects > 0) && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {[
                    tool._count.clones > 0 ? pluralize(tool._count.clones, "clone") : null,
                    tool._count.projects > 0 ? `Used by ${pluralize(tool._count.projects, "project")}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
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
  );

  const renderTable = (rows: ToolRow[]) => (
    <Card>
      <CardContent className="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="p-3 font-medium">Name</th>
              <th className="p-3 font-medium">Type</th>
              <th className="p-3 font-medium">Category</th>
              <th className="p-3 font-medium">Used by</th>
              <th className="p-3 font-medium text-right">Clones</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((tool) => (
              <tr key={tool.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                <td className="p-3">
                  <Link href={`/tools/${tool.id}`} className="font-medium hover:text-primary hover:underline">
                    {tool.name}
                  </Link>
                  {tool.description && (
                    <div className="text-xs text-muted-foreground line-clamp-1">{tool.description}</div>
                  )}
                </td>
                <td className="p-3 text-muted-foreground">{tool.toolType}</td>
                <td className="p-3 text-muted-foreground">{tool.category || "—"}</td>
                <td className="p-3 text-muted-foreground">
                  {tool.projects.length > 0
                    ? tool.projects.map((pt) => pt.project.name).join(", ")
                    : "—"}
                </td>
                <td className="p-3 text-right tabular-nums">{tool._count.clones}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );

  const renderRows = view === "table" ? renderTable : renderCards;
  const groups = groupBy ? groupRows(tools, (t) => groupKeyOf(t, groupBy)) : null;

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

      <ViewOptionsBar
        view={view}
        viewOptions={[
          { value: "cards", label: "Cards" },
          { value: "table", label: "Table" },
        ]}
        groupBy={groupBy}
        groupByOptions={[...GROUP_OPTIONS]}
      />

      {tools.length === 0 ? (
        <EmptyState icon={Wrench} title="No tools yet" description="Create your first tool" />
      ) : groups ? (
        groups.map((group) => (
          <GroupSection key={group.label} label={group.label} count={group.rows.length}>
            {renderRows(group.rows)}
          </GroupSection>
        ))
      ) : (
        renderRows(tools)
      )}
    </div>
  );
}
