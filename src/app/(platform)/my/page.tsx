import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { getUserScope, hasOrgWideScope } from "@/lib/scope";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { FolderKanban, Target } from "lucide-react";
import { formatCalendarDate } from "@/lib/dates";
import { OPEN_BID_STATUSES, bidDueState } from "@/lib/bids";
import Link from "next/link";
import { MyProjectsOverview, type OverviewRow } from "./my-projects-overview";
import { MyTasksCard } from "./my-tasks-card";

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

  const [projectPerms, bidPerms, scope] = await Promise.all([
    resolveModulePerms(user.id, user.role, "projects"),
    resolveModulePerms(user.id, user.role, "bids"),
    getUserScope(user.id, user.role),
  ]);
  const projectWhere = scope.all ? {} : { id: { in: Array.from(scope.projectIds) } };

  const [myProjects, myTasks, overviewProjects, owners, googleIntegration, myBids, myGoogleLists] =
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
        take: 30,
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
        select: { id: true, lastSyncedAt: true, lastSyncStatus: true, lastSyncError: true, autoSyncMinutes: true },
      }),
      // Open bids on my plate — deadline pressure first.
      bidPerms.canView
        ? db.bidOpportunity.findMany({
            where: { deletedAt: null, ownerId: user.id, status: { in: OPEN_BID_STATUSES } },
            select: { id: true, title: true, status: true, dueDate: true, agency: true },
            orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }],
            take: 6,
          })
        : Promise.resolve([]),
      // List names for grouping/badges on the inbox (mirror refreshed
      // by every sync). Last element — matches the destructure order.
      db.googleTaskList.findMany({
        where: { userId: user.id },
        orderBy: [{ isDefault: "desc" }, { title: "asc" }],
        select: { listId: true, title: true, isDefault: true },
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

  const listTitleById = new Map(
    myGoogleLists.map((l) => [l.listId, { title: l.title, isDefault: l.isDefault }])
  );

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

        {/* ── My open tasks (OpsHub + Google, one list) ── */}
        <MyTasksCard
          tasks={myTasks.map((task) => ({
            id: task.id,
            title: task.title,
            status: task.status,
            dueDate: task.dueDate ? task.dueDate.toISOString() : null,
            project: task.project ? { id: task.project.id, name: task.project.name } : null,
            isGoogle: task.sourceType === "google_tasks",
            sourceLink: task.sourceLink ?? null,
            listTitle:
              task.sourceType === "google_tasks"
                ? (listTitleById.get(task.googleListId ?? "")?.title ?? "Google Tasks")
                : null,
            listIsDefault:
              task.sourceType === "google_tasks"
                ? (listTitleById.get(task.googleListId ?? "")?.isDefault ?? false)
                : false,
          }))}
          projects={projectOptions}
          google={{
            connected: Boolean(googleIntegration),
            lastSyncedAt: googleIntegration?.lastSyncedAt?.toISOString() ?? null,
            lastSyncStatus: googleIntegration?.lastSyncStatus ?? null,
            lastSyncError: googleIntegration?.lastSyncError ?? null,
            autoSyncMinutes: googleIntegration?.autoSyncMinutes ?? 0,
          }}
          flash={searchParams?.google ?? null}
          assigneeId={user.id}
          now={renderedAt.toISOString()}
        />
      </div>

      {/* ── My open bids ──────────────────────────────── */}
      {myBids.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Target className="h-4 w-4" />
                My open bids ({myBids.length})
              </CardTitle>
              <Link href="/bids" className="text-xs text-primary hover:underline">
                Pipeline
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {myBids.map((bid) => {
                const due = bidDueState(bid, renderedAt);
                return (
                  <Link
                    key={bid.id}
                    href={`/bids/${bid.id}`}
                    className="flex items-center justify-between gap-2 rounded border border-border bg-muted p-2.5 hover:border-primary transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{bid.title}</p>
                      <p
                        className={`text-xs truncate ${
                          due === "overdue"
                            ? "text-destructive font-medium"
                            : due === "due-soon"
                              ? "text-warning font-medium"
                              : "text-muted-foreground"
                        }`}
                      >
                        {[bid.agency, bid.dueDate ? `due ${formatCalendarDate(bid.dueDate, "MMM d")}` : null]
                          .filter(Boolean)
                          .join(" · ") || "No deadline set"}
                      </p>
                    </div>
                    <StatusBadge status={bid.status} />
                  </Link>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

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
