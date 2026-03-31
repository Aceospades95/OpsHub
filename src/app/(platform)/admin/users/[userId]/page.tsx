import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { UserActions } from "./user-actions";
import { ModulePermissionsEditor } from "./module-permissions";
import { EntityPermissionsEditor } from "./entity-permissions";

interface Props {
  params: Promise<{ userId: string }>;
}

export default async function UserDetailPage({ params }: Props) {
  const { userId } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/dashboard");

  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      manager: { select: { id: true, name: true } },
      directReports: { select: { id: true, name: true, email: true, role: true } },
      modulePermissions: true,
      entityPermissions: true,
      projectMembers: {
        include: { project: { select: { id: true, name: true } } },
      },
    },
  });

  if (!user) notFound();

  const recentActivity = await db.activityLog.findMany({
    where: { userId },
    take: 10,
    orderBy: { createdAt: "desc" },
  });

  const allUsers = await db.user.findMany({
    where: { id: { not: userId } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const clients = await db.client.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
  const projects = await db.project.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });

  return (
    <div>
      <PageHeader
        title={user.name}
        description={`${user.email} \u00b7 ${user.role}`}
        actions={<UserActions user={user} allUsers={allUsers} />}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          {/* Profile */}
          <Card>
            <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
            <CardContent>
              <div className="flex items-center gap-4 mb-4">
                <Avatar name={user.name} size="lg" />
                <div>
                  <h3 className="text-lg font-semibold">{user.name}</h3>
                  <p className="text-sm text-muted-foreground">{user.email}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Role</p>
                  <Badge variant={user.role === "ADMIN" ? "default" : "secondary"}>{user.role}</Badge>
                </div>
                <div>
                  <p className="text-muted-foreground">Status</p>
                  <Badge variant={user.isActive ? "success" : "destructive"}>{user.isActive ? "Active" : "Inactive"}</Badge>
                </div>
                {user.department && <div><p className="text-muted-foreground">Department</p><p>{user.department}</p></div>}
                {user.jobTitle && <div><p className="text-muted-foreground">Job Title</p><p>{user.jobTitle}</p></div>}
                {user.phone && <div><p className="text-muted-foreground">Phone</p><p>{user.phone}</p></div>}
                {user.manager && (
                  <div>
                    <p className="text-muted-foreground">Manager</p>
                    <Link href={`/admin/users/${user.manager.id}`} className="text-primary hover:underline">{user.manager.name}</Link>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Module Permissions */}
          <Card>
            <CardHeader><CardTitle>Module Permissions</CardTitle></CardHeader>
            <CardContent>
              <ModulePermissionsEditor userId={user.id} permissions={user.modulePermissions} />
            </CardContent>
          </Card>

          {/* Entity Permissions */}
          <Card>
            <CardHeader><CardTitle>Entity Permissions</CardTitle></CardHeader>
            <CardContent>
              <EntityPermissionsEditor
                userId={user.id}
                permissions={user.entityPermissions}
                clients={clients}
                projects={projects}
              />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {/* Project Memberships */}
          <Card>
            <CardHeader><CardTitle>Project Memberships ({user.projectMembers.length})</CardTitle></CardHeader>
            <CardContent>
              {user.projectMembers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No project memberships</p>
              ) : (
                <div className="space-y-2">
                  {user.projectMembers.map((pm) => (
                    <Link key={pm.id} href={`/projects/${pm.project.id}`} className="flex items-center justify-between rounded border border-border p-2 hover:bg-muted">
                      <span className="text-sm">{pm.project.name}</span>
                      <Badge variant="outline">{pm.role}</Badge>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Direct Reports */}
          {user.directReports.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Direct Reports ({user.directReports.length})</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {user.directReports.map((report) => (
                    <Link key={report.id} href={`/admin/users/${report.id}`} className="flex items-center gap-2 rounded border border-border p-2 hover:bg-muted">
                      <Avatar name={report.name} size="xs" />
                      <span className="text-sm">{report.name}</span>
                      <Badge variant="outline">{report.role}</Badge>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Recent Activity */}
          <Card>
            <CardHeader><CardTitle>Recent Activity</CardTitle></CardHeader>
            <CardContent>
              {recentActivity.length === 0 ? (
                <p className="text-sm text-muted-foreground">No recent activity</p>
              ) : (
                <div className="space-y-2">
                  {recentActivity.map((log) => (
                    <div key={log.id} className="text-sm">
                      <p>
                        <Badge variant="outline" className="mr-1">{log.action}</Badge>
                        {log.entityType}
                        {log.details && <span className="text-muted-foreground"> \u2014 {log.details}</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDistanceToNow(log.createdAt, { addSuffix: true })}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
