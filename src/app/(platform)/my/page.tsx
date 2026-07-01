import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { getUserScope, hasOrgWideScope } from "@/lib/scope";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { TaskCheckbox } from "@/app/(platform)/tasks/task-checkbox";
import { formatCalendarDate } from "@/lib/dates";
import { CheckSquare, FolderKanban, Clock } from "lucide-react";
import Link from "next/link";
import { MyProjectsOverview, type OverviewRow } from "./my-projects-overview";
import { MyQuickAddTask } from "./my-quick-add-task";
import { GoogleTasksSection } from "./google-tasks-section";

export const metadata = { title: "My View · OpsHub" };

/**
 * The personal landing page: what's mine, what's next, and a
 * spreadsheet-style overview of every project I can see with inline
 * status + notes editing. This page is deliberately NOT built on the
 * page-layout widget system — it has one job and a fixed shape.
 */
export default async function MyViewPage({
  searchParams,
}: {
  searchParams?: { google?: string };
}) {
  const user = await requireAuth();
  const renderedAt = new Date();

  const [projectPerms, scope] = await Promise.all([
    resolveModulePerms(user.id, user.role, "projects"),
    getUserScope(user.id, user.role),
  ]);
  const projectWhere = scope.all ? {} : { id: { in: Array.from(scope.projectIds) } };

  const [myProjects, myTasks, overviewProjects, owners, googleIntegration, googleInbox] =
    await Promise.all([
      // Projects on my plate: owned, member of, or actively assigned.
      db.project.findMany({
        where: {
          deletedAt: null,
          status: { in: ["PLANNING", "ACTIVE", "ON_HOLD"] },
          OR: [
            { ownerId: user.id },
            { members: { some: { userId: user.id } } },
            { assignments: { some: { employeeId: user.id, status: { in: ["ACTIVE", "PLANNED"] } } } },
          ],
        },
        include: {
          client: { select: { id: true, name: true } },
          _count: {
            select: {
              tasks: { where: { status: { in: ["TODO", "IN_PROGRESS"] }, deletedAt: null } },
            },
          },
        },
        orderBy: { updatedAt: "desc" },
        take: 12,
      }),
      // My open tasks, soonest due first (undated last).
      db.task.findMany({
        where: {
          assigneeId: user.id,
          status: { in: ["TODO", "IN_PROGRESS"] },
          deletedAt: null,
        },
        include: { project: { select: { id: true, name: true } } },
        orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { priority: "asc" }],
        take: 25,
      }),
      // Everything I can see, for the inline-editable overview table.
      db.project.findMany({
        where: { deletedAt: null, ...projectWhere },
        include: {
          client: { select: { id: true, name: true } },
          owner: { select: { id: true, name: true } },
          _count: {
            select: {
              tasks: { where: { status: { in: ["TODO", "IN_PROGRESS"] }, deletedAt: null } },
            },
          },
        },
        orderBy: [{ client: { name: "asc" } }, { name: "asc" }],
      }),
      // Owner picker options (org-wide editors only use this).
      hasOrgWideScope(user.role)
        ? db.user.findMany({
            where: { isActive: true },
            select: { id: true, name: true },
            orderBy: { name: "asc" },
          })
        : Promise.resolve([] as { id: string; name: string }[]),
      db.googleTasksIntegration.findUnique({
        where: { userId: user.id },
        select: { id: true, tasklistId: true, lastSyncedAt: true, lastSyncStatus: true, lastSyncError: true },
      }),
      // Google-synced tasks not yet filed under a project — the triage inbox.
      db.task.findMany({
        where: {
          assigneeId: user.id,
          sourceType: "google_tasks",
          projectId: null,
          status: { in: ["TODO", "IN_PROGRESS"] },
          deletedAt: null,
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
    ]);

  const overviewRows: OverviewRow[] = overviewProjects.map((p) => ({
    id: p.id,
    name: p.name,
    href: `/projects/${p.slug ?? p.id}`,
    clientName: p.client.name,
    clientId: p.client.id,
    status: p.status,
    ownerId: p.ownerId,
    ownerName: p.owner?.name ?? null,
    notes: p.notes,
    openTasks: p._count.tasks,
    updatedAt: p.updatedAt.toISOString(),
  }));

  const projectOptions = overviewProjects
    .filter((p) => p.status === "PLANNING" || p.status === "ACTIVE")
    .map((p) => ({ id: p.id, name: p.name }));

  return (
    <div>
      <PageHeader
        title="My View"
        description="Your projects, your open tasks, and the full portfolio — editable in place."
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* ── My projects ─────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FolderKanban className="h-4 w-4" />
              My projects ({myProjects.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {myProjects.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing on your plate — set yourself as owner on a project in the overview below.
              </p>
            ) : (
              <div className="space-y-2">
                {myProjects.map((p) => (
                  <Link
                    key={p.id}
                    href={`/projects/${p.slug ?? p.id}`}
                    className="flex items-center justify-between rounded border border-border bg-muted p-3 hover:border-primary transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{p.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {p.client.name}
                        {p._count.tasks > 0 && ` · ${p._count.tasks} open ${p._count.tasks === 1 ? "task" : "tasks"}`}
                      </p>
                    </div>
                    <StatusBadge status={p.status} />
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── My open tasks ───────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckSquare className="h-4 w-4" />
              My tasks ({myTasks.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <MyQuickAddTask projects={projectOptions} assigneeId={user.id} />
            {myTasks.length === 0 ? (
              <p className="text-sm text-muted-foreground mt-3">No open tasks. Enjoy it while it lasts.</p>
            ) : (
              <div className="space-y-2 mt-3">
                {myTasks.map((task) => {
                  const overdue = task.dueDate ? task.dueDate < renderedAt : false;
                  return (
                    <div key={task.id} className="flex items-start gap-3 text-sm">
                      <TaskCheckbox taskId={task.id} status={task.status} />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">{task.title}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          {task.project && (
                            <Link
                              href={`/projects/${task.project.id}`}
                              className="hover:text-primary hover:underline truncate"
                            >
                              {task.project.name}
                            </Link>
                          )}
                          {task.dueDate && (
                            <span className={`flex items-center gap-1 shrink-0 ${overdue ? "text-destructive" : ""}`}>
                              <Clock className="h-3 w-3" />
                              {formatCalendarDate(task.dueDate, "MMM d")}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Google Tasks inbox / connect ──────────────── */}
      <GoogleTasksSection
        connected={Boolean(googleIntegration)}
        flash={searchParams?.google ?? null}
        lastSyncedAt={googleIntegration?.lastSyncedAt?.toISOString() ?? null}
        lastSyncStatus={googleIntegration?.lastSyncStatus ?? null}
        lastSyncError={googleIntegration?.lastSyncError ?? null}
        inbox={googleInbox.map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          dueDate: t.dueDate ? t.dueDate.toISOString() : null,
        }))}
        projects={projectOptions}
      />

      {/* ── All projects, editable in place ───────────── */}
      <MyProjectsOverview
        rows={overviewRows}
        canEdit={projectPerms.canEdit}
        owners={owners}
        canAssignOwner={hasOrgWideScope(user.role)}
        currentUserId={user.id}
      />
    </div>
  );
}
