import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import Link from "next/link";
import { UserCreateButton } from "./user-create-button";
import { ToggleActiveButton } from "./toggle-active-button";

export default async function AdminUsersPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/dashboard");

  const users = await db.user.findMany({
    orderBy: { name: "asc" },
    include: {
      manager: { select: { name: true } },
    },
  });

  const allUsers = await db.user.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <div>
      <PageHeader
        title="User Management"
        description="Manage users, roles, and permissions"
        actions={<UserCreateButton allUsers={allUsers} />}
      />

      <Card>
        <CardContent className="p-0">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left p-4 text-sm font-medium text-muted-foreground">User</th>
                <th className="text-left p-4 text-sm font-medium text-muted-foreground">Role</th>
                <th className="text-left p-4 text-sm font-medium text-muted-foreground">Department</th>
                <th className="text-left p-4 text-sm font-medium text-muted-foreground">Status</th>
                <th className="text-left p-4 text-sm font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                  <td className="p-4">
                    <Link href={`/admin/users/${user.id}`} className="flex items-center gap-3 hover:text-primary">
                      <Avatar name={user.name} size="sm" />
                      <div>
                        <p className="text-sm font-medium">{user.name}</p>
                        <p className="text-xs text-muted-foreground">{user.email}</p>
                      </div>
                    </Link>
                  </td>
                  <td className="p-4">
                    <Badge variant={user.role === "ADMIN" ? "default" : user.role === "MANAGER" ? "success" : "secondary"}>
                      {user.role}
                    </Badge>
                  </td>
                  <td className="p-4 text-sm text-muted-foreground">{user.department || "\u2014"}</td>
                  <td className="p-4">
                    <ToggleActiveButton userId={user.id} isActive={user.isActive} />
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
        </CardContent>
      </Card>
    </div>
  );
}
