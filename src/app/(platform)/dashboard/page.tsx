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
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { id: userId, role } = session.user;

  const clientPerms = await resolveModulePerms(userId, role, "clients");
  const projectPerms = await resolveModulePerms(userId, role, "projects");
  const contractPerms = await resolveModulePerms(userId, role, "contracts");

  const [
    clientCount,
    projectCount,
    activeProjectCount,
    contractCount,
    expiringContracts,
    teamCount,
    recentActivity,
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
      include: { user: { select: { name: true } } },
    }),
  ]);

  const stats = [
    {
      label: "Total Clients",
      value: clientCount,
      icon: Building2,
      href: "/clients",
      visible: clientPerms.canView,
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
    },
    {
      label: "Team Members",
      value: teamCount,
      icon: Users,
      href: "/admin/users",
      visible: true,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description={`Welcome back, ${session.user.name}`}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        {stats
          .filter((s) => s.visible)
          .map((stat) => {
            const Icon = stat.icon;
            return (
              <Link key={stat.label} href={stat.href}>
                <Card className="hover:shadow-md transition-shadow">
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">{stat.label}</p>
                        <p className="text-3xl font-bold text-foreground">{stat.value}</p>
                        {stat.sub && (
                          <p className="text-xs text-muted-foreground mt-1">{stat.sub}</p>
                        )}
                      </div>
                      <Icon className="h-8 w-8 text-primary/60" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
      </div>

      {expiringContracts > 0 && contractPerms.canView && (
        <Card className="mb-8 border-warning/50">
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
      )}

      <Card>
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
                      <span className="font-medium">{log.user.name}</span>{" "}
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
    </div>
  );
}
