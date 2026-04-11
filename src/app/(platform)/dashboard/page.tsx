import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { resolveModulePerms } from "@/lib/permissions";
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
import { formatDistanceToNow, format } from "date-fns";
import Link from "next/link";
import { DashboardTaskCheckbox } from "./dashboard-task-checkbox";
import { PageLayout } from "@/components/shared/page-layout";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { id: userId, role } = session.user;

  const canEditLayout = session.user.role === "ADMIN" || session.user.role === "DEVELOPER";

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
    projectCount,
    activeProjectCount,
    contractCount,
    expiringContracts,
    teamCount,
    recentActivity,
    myTasks,
    myRecentCompleted,
    openTaskCount,
  ] = await Promise.all([
    clientPerms.canView ? db.client.count() : Promise.resolve(0),
    projectPerms.canView ? db.project.count() : Promise.resolve(0),
    projectPerms.canView
      ? db.project.count({ where: { status: "ACTIVE" } })
      : Promise.resolve(0),
    contractPerms.canView ? db.contract.count({ where: { status: "ACTIVE" } }) : Promise.resolve(0),
    contractPerms.canView
      ? db.contract.count({
          where: {
            status: { in: ["EXPIRING_SOON", "EXPIRED"] },
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
      },
      take: 5,
      orderBy: { completedAt: "desc" },
      include: {
        project: { select: { id: true, name: true } },
      },
    }),
    db.task.count({
      where: { status: { in: ["TODO", "IN_PROGRESS"] } },
    }),
  ]);

  const stats = [
    {
      label: "Total Clients",
      value: clientCount,
      icon: Building2,
      href: "/clients",
      visible: clientPerms.canView,
      sub: "\u00A0",
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
      label: "Open Tasks",
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
                          <span className="text-sm font-medium truncate">{task.title}</span>
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
                            <span className={`flex items-center gap-1 ${new Date(task.dueDate) < new Date() ? "text-destructive" : ""}`}>
                              <Clock className="h-3 w-3" />
                              {format(new Date(task.dueDate), "MMM d")}
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
                        <span className="text-sm line-through truncate block">{task.title}</span>
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
  };

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description={`Welcome back, ${session.user.name}`}
      />

      <PageLayout pageType="dashboard" cards={cardMap} canEdit={canEditLayout} />
    </div>
  );
}
