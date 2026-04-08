import { auth } from "@/lib/auth";
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

export default async function AdminUsersPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/dashboard");

  const [activeUsers, inactiveUsers, allUsers] = await Promise.all([
    db.user.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      include: { manager: { select: { name: true } } },
    }),
    db.user.findMany({
      where: { isActive: false },
      orderBy: { name: "asc" },
      include: { manager: { select: { name: true } } },
    }),
    db.user.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  function renderUserTable(users: typeof activeUsers, dimmed = false) {
    return (
      <table className="w-full">
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
            <tr key={user.id} className={`border-b border-border last:border-0 hover:bg-muted/50 ${dimmed ? "opacity-60" : ""}`}>
              <td className="p-4">
                <Link href={`/admin/users/${user.id}`} className="flex items-center gap-3 hover:text-primary">
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
                </div>
              </td>
              <td className="p-4">
                <Link href={`/admin/users/${user.id}`} className="text-sm text-primary hover:underline">
                  Manage
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <div>
      <PageHeader
        title="User Management"
        description="Manage users, roles, and permissions"
        actions={<UserCreateButton allUsers={allUsers} />}
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
