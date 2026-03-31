import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { resolveModulePerms } from "@/lib/permissions";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Wrench } from "lucide-react";
import Link from "next/link";
import { ToolCreateButton } from "./tool-create-button";

export default async function ToolsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const perms = await resolveModulePerms(session.user.id, session.user.role, "tools");
  if (!perms.canView) redirect("/dashboard");

  const tools = await db.tool.findMany({
    where: { isGlobal: true },
    orderBy: { name: "asc" },
    include: {
      _count: { select: { clones: true, projects: true } },
    },
  });

  return (
    <div>
      <PageHeader
        title="Tools"
        description="Company tools, forms, and calculators"
        actions={perms.canCreate ? <ToolCreateButton /> : undefined}
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
                      <span className="text-xs text-muted-foreground">{tool._count.clones} clones</span>
                    )}
                    {tool._count.projects > 0 && (
                      <span className="text-xs text-muted-foreground">{tool._count.projects} projects</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
