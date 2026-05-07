import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { canAccessSandbox } from "@/lib/permissions";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Avatar } from "@/components/ui/avatar";
import { Blocks } from "lucide-react";
import Link from "next/link";
import { SandboxCreateButton } from "./sandbox-create-button";
import { SettingsNav } from "@/app/(platform)/admin/settings-nav";
import { Icon } from "@/components/ui/icon-picker";
import type { Role } from "@prisma/client";

export default async function SandboxListPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canAccessSandbox(session.user.role as Role)) redirect("/dashboard");

  const isAdmin = session.user.role === "ADMIN";

  const pages = await db.sandboxPage.findMany({
    where: isAdmin
      ? {}
      : {
          OR: [
            { createdById: session.user.id },
            { published: true },
          ],
        },
    orderBy: { updatedAt: "desc" },
    include: {
      createdBy: { select: { name: true } },
      project: { select: { id: true, name: true } },
      client: { select: { id: true, name: true } },
    },
  });

  const [projects, clients] = await Promise.all([
    db.project.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.client.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div>
      {/* /sandbox lives outside the admin route segment so the
       *  admin layout's SettingsNav doesn't render here. The
       *  Settings hub links to /sandbox under "Custom Pages", so
       *  giving this page the same back-link as every other
       *  admin sub-page keeps the navigation symmetric. */}
      <SettingsNav />
      <PageHeader
        title="Custom Pages"
        description="Create and manage custom pages and modules"
        actions={<SandboxCreateButton projects={projects} clients={clients} />}
      />

      {pages.length === 0 ? (
        <EmptyState
          icon={Blocks}
          title="No sandbox pages yet"
          description="Create your first experimental page"
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {pages.map((page) => (
            <Link key={page.id} href={`/sandbox/${page.id}`}>
              <Card className="hover:shadow-md transition-shadow h-full">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Icon name={page.icon} className="h-4 w-4 text-muted-foreground shrink-0" />
                      <h3 className="font-semibold text-foreground truncate">{page.title}</h3>
                    </div>
                    {page.published ? (
                      <Badge variant="success">Published</Badge>
                    ) : (
                      <Badge variant="secondary">Draft</Badge>
                    )}
                  </div>
                  {page.description && (
                    <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{page.description}</p>
                  )}
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Avatar name={page.createdBy.name} size="xs" />
                      <span>{page.createdBy.name}</span>
                    </div>
                    <Badge variant="outline">{page.layout}</Badge>
                  </div>
                  {(page.project || page.client) && (
                    <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                      {page.client && <span>{page.client.name}</span>}
                      {page.project && <span>{page.project.name}</span>}
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
