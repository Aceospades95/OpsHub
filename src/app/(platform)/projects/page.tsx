import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { resolveModulePerms } from "@/lib/permissions";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { FolderKanban } from "lucide-react";
import { format } from "date-fns";
import Link from "next/link";
import { ProjectCreateButton } from "./project-create-button";

export default async function ProjectsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const perms = await resolveModulePerms(session.user.id, session.user.role, "projects");
  if (!perms.canView) redirect("/dashboard");

  const projects = await db.project.findMany({
    where: { parentProjectId: null },
    orderBy: { updatedAt: "desc" },
    include: {
      client: { select: { name: true } },
      _count: { select: { members: true, childProjects: true } },
    },
  });

  const clients = await db.client.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <div>
      <PageHeader
        title="Projects"
        description="Manage projects across all clients"
        actions={
          perms.canCreate ? <ProjectCreateButton clients={clients} /> : undefined
        }
      />

      {projects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects yet"
          description="Create your first project to get started"
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Link key={project.id} href={`/projects/${project.id}`}>
              <Card className="hover:shadow-md transition-shadow h-full">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="font-semibold text-foreground">{project.name}</h3>
                    <StatusBadge status={project.status} />
                  </div>
                  <p className="text-sm text-muted-foreground mb-3">
                    {project.client.name}
                  </p>
                  {(project.startDate || project.endDate) && (
                    <p className="text-xs text-muted-foreground mb-2">
                      {project.startDate && format(project.startDate, "MMM d, yyyy")}
                      {project.startDate && project.endDate && " — "}
                      {project.endDate && format(project.endDate, "MMM d, yyyy")}
                    </p>
                  )}
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    <span>{project._count.members} members</span>
                    {project._count.childProjects > 0 && (
                      <span>{project._count.childProjects} sub-projects</span>
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
