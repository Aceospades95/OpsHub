import { requireAuth } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { MapPin } from "lucide-react";
import Link from "next/link";
import { UserCreateButton } from "./user-create-button";
import { ToggleActiveButton } from "./toggle-active-button";
import { ADMIN_SETTING_KEYS, getBooleanAdminSetting } from "@/lib/admin-settings";

export const metadata = { title: "User Management · OpsHub" };

export default async function AdminUsersPage() {
  const user = await requireAuth();
  if (user.role !== "ADMIN") redirect("/dashboard");

  const [activeUsers, inactiveUsers, allUsers, workflowTemplates, defaultSendWelcomeEmail] = await Promise.all([
    db.user.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      include: {
        manager: { select: { name: true } },
        accounts: { select: { provider: true } },
      },
    }),
    db.user.findMany({
      where: { isActive: false },
      orderBy: { name: "asc" },
      include: {
        manager: { select: { name: true } },
        accounts: { select: { provider: true } },
      },
    }),
    db.user.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.workflowTemplate.findMany({
      where: { isActive: true, subjectEntityType: "EMPLOYEE" },
      select: { id: true, name: true, type: true },
      orderBy: [{ isSeed: "desc" }, { name: "asc" }],
    }),
    getBooleanAdminSetting(ADMIN_SETTING_KEYS.sendWelcomeEmailDefault, true),
  ]);

  function renderUserTable(users: typeof activeUsers, dimmed = false) {
    return (
      <div className="overflow-x-auto"><table className="w-full">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left p-4 text-sm font-medium text-muted-foreground">User</th>
            <th className="text-left p-4 text-sm font-medium text-muted-foreground">Role</th>
            <th className="text-left p-4 text-sm font-medium text-muted-foreground hidden md:table-cell">Department</th>
            <th className="text-left p-4 text-sm font-medium text-muted-foreground hidden lg:table-cell">Location</th>
            <th className="text-left p-4 text-sm font-medium text-muted-foreground">Status</th>
            <th className="text-left p-4 text-sm font-medium text-muted-foreground">Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id} className={`border-b border-border last:border-0 hover:bg-muted ${dimmed ? "opacity-60" : ""}`}>
              <td className="p-4">
                <Link href={`/team/${user.id}`} className="flex items-center gap-3 hover:text-primary">
                  <Avatar name={user.name} size="sm" />
                  <div>
                    <p className="text-sm font-medium">{user.name}</p>
                    <p className="text-xs text-muted-foreground">{user.email}</p>
                    {user.jobTitle && <p className="text-xs text-primary/80 font-medium">{user.jobTitle}</p>}
                  </div>
                </Link>
              </td>
              <td className="p-4">
                <Badge variant={user.role === "ADMIN" ? "default" : user.role === "MANAGER" ? "success" : user.role === "DEVELOPER" ? "warning" : "secondary"}>
                  {user.role}
                </Badge>
              </td>
              <td className="p-4 text-sm text-muted-foreground hidden md:table-cell">{user.department || "—"}</td>
              <td className="p-4 text-sm text-muted-foreground hidden lg:table-cell">
                {user.location ? (
                  <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{user.location}</span>
                ) : "—"}
              </td>
              <td className="p-4">
                <div className="flex items-center gap-2">
                  <ToggleActiveButton userId={user.id} isActive={user.isActive} />
                  {!user.hasLoginAccess && (
                    <Badge variant="outline" className="text-[10px]">No Login</Badge>
                  )}
                  {user.accounts.some((a) => a.provider === "google") && (
                    <span title="Linked to a Google account for SSO">
                      <Badge variant="outline" className="text-[10px]">
                        Google
                      </Badge>
                    </span>
                  )}
                </div>
              </td>
              <td className="p-4">
                <Link href={`/team/${user.id}`} className="text-sm text-primary hover:underline">
                  Manage
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
    );
  }

  return (
    <div>
      <PageHeader
        title="User Management"
        description="Manage users, roles, and permissions"
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/admin/users/merge"
              className="inline-flex items-center rounded border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted/40 transition-colors"
              title="Consolidate two duplicate user rows into one"
            >
              Merge employees
            </Link>
            <UserCreateButton allUsers={allUsers} workflowTemplates={workflowTemplates} defaultSendWelcomeEmail={defaultSendWelcomeEmail} />
          </div>
        }
      />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            Active Accounts
            <Badge variant="success">{activeUsers.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {renderUserTable(activeUsers)}
        </CardContent>
      </Card>

      {inactiveUsers.length > 0 && (
        <Card className="opacity-80">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground">
              Deactivated Accounts
              <Badge variant="outline">{inactiveUsers.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {renderUserTable(inactiveUsers, true)}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
