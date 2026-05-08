import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import {
  Building2,
  FolderKanban,
  FileText,
  Users,
  AlertTriangle,
  Activity,
  CheckSquare,
  Clock,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { formatCalendarDate } from "@/lib/dates";
import Link from "next/link";
import { DashboardTaskCheckbox } from "./dashboard-task-checkbox";
import { PageLayout } from "@/components/shared/page-layout";

export default async function DashboardPage() {
  const user = await requireAuth();

  const { id: userId, role } = user;

  // Single "now" for the whole render so the past-due indicator on
  // task rows agrees with itself across the page (and so we don't
  // create N Date objects per row in the JSX). The server component
  // re-renders on every visit, so the value stays fresh.
  const renderedAt = new Date();

  const canEditLayout = user.role === "ADMIN" || user.role === "DEVELOPER";

  const clientPerms = await resolveModulePerms(userId, role, "clients");
  const projectPerms = await resolveModulePerms(userId, role, "projects");
  const contractPerms = await resolveModulePerms(userId, role, "contracts");

  // Recently completed window — show tasks the current user has marked done
  // in the last 14 days so there's some sense of recent progress alongside
  // the open work.
  const recentlyCompletedSince = new Date();
  recentlyCompletedSince.setDate(recentlyCompletedSince.getDate() - 14);

  const [
    clientCount,
    clientStatusBreakdown,
    projectCount,
    activeProjectCount,
    contractCount,
    expiringContracts,
    teamCount,
    recentActivity,
    myTasks,
    myRecentCompleted,
    openTaskCount,
    activeProjects,
    teamMembers,
  ] = await Promise.all([
    clientPerms.canView ? db.client.count({ where: { deletedAt: null } }) : Promise.resolve(0),
    // Round-7 QA: the previous "{n} active" sub read as "the
    // remainder are inactive", but in practice a Client row is one
    // of ACTIVE / PROSPECT / INACTIVE / ARCHIVED. Pull the full
    // groupBy so the sub-line can show the actual mix. Round-2's
    // active-only sub was misleading when a deployment had any
    // PROSPECT rows.
    clientPerms.canView
      ? db.client.groupBy({
          by: ["status"],
          where: { deletedAt: null },
          _count: { _all: true },
        })
      : Promise.resolve([] as { status: string; _count: { _all: number } }[]),
    projectPerms.canView ? db.project.count({ where: { deletedAt: null } }) : Promise.resolve(0),
    projectPerms.canView
      ? db.project.count({ where: { status: "ACTIVE", deletedAt: null } })
      : Promise.resolve(0),
    contractPerms.canView ? db.contract.count({ where: { status: "ACTIVE", deletedAt: null } }) : Promise.resolve(0),
    contractPerms.canView
      ? db.contract.count({
          where: {
            status: { in: ["EXPIRING_SOON", "EXPIRED"] },
            deletedAt: null,
          },
        })
      : Promise.resolve(0),
    db.user.count({ where: { isActive: true } }),
    db.activityLog.findMany({
      take: 10,
      orderBy: { createdAt: "desc" },
      include: { user: { select: { id: true, name: true } } },
    }),
    db.task.findMany({
      where: {
        status: { in: ["TODO", "IN_PROGRESS"] },
        assigneeId: userId,
        deletedAt: null,
      },
      take: 8,
      orderBy: [{ priority: "asc" }, { dueDate: "asc" }],
      include: {
        project: { select: { id: true, name: true } },
        client: { select: { id: true, name: true } },
        assignee: { select: { name: true } },
      },
    }),
    db.task.findMany({
      where: {
        status: "DONE",
        assigneeId: userId,
        completedAt: { gte: recentlyCompletedSince },
        deletedAt: null,
      },
      take: 5,
      orderBy: { completedAt: "desc" },
      include: {
        project: { select: { id: true, name: true } },
      },
    }),
    db.task.count({
      where: { status: { in: ["TODO", "IN_PROGRESS"] }, deletedAt: null },
    }),
    // Active projects with status for overview card
    projectPerms.canView
      ? db.project.findMany({
          where: { status: { in: ["PLANNING", "ACTIVE", "ON_HOLD"] }, deletedAt: null },
          take: 8,
          orderBy: { updatedAt: "desc" },
          select: {
            id: true,
            name: true,
            status: true,
            client: { select: { name: true } },
            _count: { select: { tasks: { where: { status: { in: ["TODO", "IN_PROGRESS"] } } } } },
          },
        })
      : Promise.resolve([]),
    // Team summary
    db.user.findMany({
      where: { isActive: true, hasLoginAccess: true },
      take: 8,
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        jobTitle: true,
        department: true,
        _count: { select: { assignments: { where: { status: "ACTIVE" } } } },
      },
    }),
  ]);

  // Build a non-zero-only sub-line from the status breakdown so the
  // dashboard reads "3 active · 2 prospect" instead of "3 active"
  // when the remainder isn't in the inactive/archived bucket the
  // user might assume. Lowercase status labels for sentence-flow.
  const statusOrder = ["ACTIVE", "PROSPECT", "INACTIVE", "ARCHIVED"] as const;
  const clientByStatus = new Map<string, number>(
    Array.isArray(clientStatusBreakdown)
      ? clientStatusBreakdown.map((b) => [b.status, b._count._all])
      : []
  );
  const clientSubParts = statusOrder
    .map((s) => ({ status: s, n: clientByStatus.get(s) ?? 0 }))
    .filter((b) => b.n > 0)
    .map((b) => `${b.n} ${b.status.toLowerCase()}`);
  const clientSub = clientSubParts.length > 0 ? clientSubParts.join(" · ") : "";

  const stats = [
    {
      label: "Total Clients",
      value: clientCount,
      icon: Building2,
      href: "/clients",
      visible: clientPerms.canView,
      sub: clientSub,
    },
    {
      label: "Projects",
      value: projectCount,
      icon: FolderKanban,
      href: "/projects",
      visible: projectPerms.canView,
      sub: `${activeProjectCount} active`,
    },
    {
      label: "Active Contracts",
      value: contractCount,
      icon: FileText,
      href: "/contracts",
      visible: contractPerms.canView,
      sub: "\u00A0",
    },
    {
      // Renamed from "Open Tasks" to match the /tasks page filter
      // chip ("Active") and to remove the QA-flagged ambiguity \u2014
      // value is TODO + IN_PROGRESS, never includes DONE.
      label: "Active Tasks",
      value: openTaskCount,
      icon: CheckSquare,
      href: "/tasks",
      visible: true,
      sub: `${myTasks.length} assigned to you`,
    },
  ];

  const priorityColors: Record<string, string> = {
    HIGH: "bg-red-100 text-red-800",
    MEDIUM: "bg-yellow-100 text-yellow-800",
    LOW: "bg-green-100 text-green-800",
  };

  const cardMap: Record<string, React.ReactNode> = {
    stats: (
      <div className="h-full grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 content-start">
        {stats
          .filter((s) => s.visible)
          .map((stat) => {
            const Icon = stat.icon;
            return (
              <Link key={stat.label} href={stat.href}>
                <Card className="hover:shadow-lg transition-shadow h-full border-border/60 shadow-sm">
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">{stat.label}</p>
                        <p className="text-3xl font-bold text-foreground">{stat.value}</p>
                        <p className="text-xs text-muted-foreground mt-1 min-h-[1rem]">
                          {stat.sub}
                        </p>
                      </div>
                      <Icon className="h-8 w-8 text-primary/60" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
      </div>
    ),
    alerts: expiringContracts > 0 && contractPerms.canView ? (
      <Card className="border-warning/50 h-full">
        <CardContent className="p-4 flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-warning" />
          <p className="text-sm">
            <strong>{expiringContracts}</strong> contract{expiringContracts !== 1 ? "s" : ""}{" "}
            expiring soon or expired.{" "}
            <Link href="/contracts" className="text-primary hover:underline">
              Review now
            </Link>
          </p>
        </CardContent>
      </Card>
    ) : (
      <Card className="h-full">
        <CardContent className="p-4 flex items-center gap-3">
          <CheckSquare className="h-5 w-5 text-success" />
          <p className="text-sm text-muted-foreground">No alerts — all contracts are up to date</p>
        </CardContent>
      </Card>
    ),
    "my-tasks": (
      <Card className="h-full">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <CheckSquare className="h-5 w-5" />
              My Tasks
            </CardTitle>
            <Link href="/tasks" className="text-sm text-primary hover:underline">
              View all
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {myTasks.length === 0 && myRecentCompleted.length === 0 ? (
            <p className="text-sm text-muted-foreground">No open tasks</p>
          ) : (
            <div className="space-y-4">
              {/* Active tasks */}
              {myTasks.length > 0 && (
                <div className="space-y-2">
                  {myTasks.map((task) => (
                    <div key={task.id} className="flex items-center gap-3 py-1">
                      <DashboardTaskCheckbox taskId={task.id} status={task.status} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate" title={task.title}>{task.title}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${priorityColors[task.priority]}`}>
                            {task.priority}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          {task.project && (
                            <Link href={`/projects/${task.project.id}`} className="hover:text-primary hover:underline">
                              {task.project.name}
                            </Link>
                          )}
                          {task.client && (
                            <Link href={`/clients/${task.client.id}`} className="hover:text-primary hover:underline">
                              {task.client.name}
                            </Link>
                          )}
                          {task.dueDate && (
                            <span className={`flex items-center gap-1 ${new Date(task.dueDate) < renderedAt ? "text-destructive" : ""}`}>
                              <Clock className="h-3 w-3" />
                              {formatCalendarDate(task.dueDate, "MMM d")}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Recently completed — last 14 days */}
              {myRecentCompleted.length > 0 && (
                <div className="space-y-2 pt-3 border-t border-border">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    Recently completed
                  </p>
                  {myRecentCompleted.map((task) => (
                    <div key={task.id} className="flex items-center gap-3 py-0.5 opacity-70">
                      <DashboardTaskCheckbox taskId={task.id} status={task.status} />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm line-through truncate block" title={task.title}>{task.title}</span>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          {task.project && (
                            <Link href={`/projects/${task.project.id}`} className="hover:text-primary hover:underline">
                              {task.project.name}
                            </Link>
                          )}
                          {task.completedAt && (
                            <span>{formatDistanceToNow(task.completedAt, { addSuffix: true })}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    ),
    activity: (
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Recent Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recentActivity.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recent activity</p>
          ) : (
            <div className="space-y-3">
              {recentActivity.map((log) => (
                <div key={log.id} className="flex items-start gap-3">
                  <Avatar name={log.user.name} size="xs" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">
                      <Link href={`/team/${log.user.id}`} className="font-medium hover:text-primary hover:underline">
                        {log.user.name}
                      </Link>{" "}
                      <span className="text-muted-foreground">{log.action}</span>{" "}
                      <span className="text-muted-foreground">
                        {log.entityType}
                      </span>
                      {log.details && (
                        <span className="text-muted-foreground"> — {log.details}</span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDistanceToNow(log.createdAt, { addSuffix: true })}
                    </p>
                  </div>
                  <Badge variant="outline" className="shrink-0">
                    {log.action}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    ),
    "projects-overview": projectPerms.canView ? (
      <Card className="h-full">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <FolderKanban className="h-5 w-5" />
              {/* Pulls PLANNING + ACTIVE + ON_HOLD — "in progress" is
               *  the umbrella label that fits all three. Round-2 QA
               *  flagged the prior "Active Projects" header was wrong
               *  when only PLANNING projects existed. */}
              Projects in Progress
            </CardTitle>
            <Link href="/projects" className="text-sm text-primary hover:underline">View all</Link>
          </div>
        </CardHeader>
        <CardContent>
          {activeProjects.length === 0 ? (
            <p className="text-sm text-muted-foreground">No projects in progress</p>
          ) : (
            <div className="space-y-2">
              {activeProjects.map((p: { id: string; name: string; status: string; client: { name: string } | null; _count: { tasks: number } }) => (
                <Link key={p.id} href={`/projects/${p.id}`} className="flex items-center gap-3 rounded border border-border bg-muted p-3 hover:border-primary hover:bg-muted transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" title={p.name}>{p.name}</p>
                    <p className="text-xs text-muted-foreground truncate" title={p.client?.name || "No client"}>{p.client?.name || "No client"}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {p._count.tasks > 0 && (
                      <span className="text-xs text-muted-foreground">{p._count.tasks} open</span>
                    )}
                    <Badge variant="outline" className="text-[10px]">{p.status}</Badge>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    ) : null,
    "team-summary": (
      <Card className="h-full">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Team ({teamCount})
            </CardTitle>
            <Link href="/team" className="text-sm text-primary hover:underline">View all</Link>
          </div>
        </CardHeader>
        <CardContent>
          {teamMembers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No team members</p>
          ) : (
            <div className="space-y-2">
              {teamMembers.map((m: { id: string; name: string; jobTitle: string | null; department: string | null; _count: { assignments: number } }) => (
                <Link key={m.id} href={`/team/${m.id}`} className="flex items-center gap-3 rounded border border-border bg-muted p-3 hover:border-primary hover:bg-muted transition-colors">
                  <Avatar name={m.name} size="xs" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" title={m.name}>{m.name}</p>
                    <p className="text-xs text-muted-foreground truncate" title={m.jobTitle || m.department || "Team member"}>{m.jobTitle || m.department || "Team member"}</p>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">{m._count.assignments} active</span>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    ),
  };

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description={`Welcome back, ${user.name}`}
      />

      <PageLayout pageType="dashboard" cards={cardMap} canEdit={canEditLayout} />
    </div>
  );
}
