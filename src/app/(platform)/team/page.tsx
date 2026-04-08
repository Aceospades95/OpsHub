import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/layout/page-header";
import { TeamPageClient } from "./team-page-client";
import { AddEmployeeButton } from "./add-employee-button";

export default async function TeamPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const canManage = session.user.role === "ADMIN" || session.user.role === "MANAGER";

  const [activeUsers, inactiveUsers, projects, allUsers] = await Promise.all([
    db.user.findMany({
      where: { isActive: true },
      select: {
        id: true, name: true, email: true, role: true,
        jobTitle: true, department: true, location: true,
        avatar: true, managerId: true, isActive: true,
        manager: { select: { id: true, name: true } },
        projectMembers: {
          include: { project: { select: { id: true, name: true, status: true } } },
        },
      },
      orderBy: { name: "asc" },
    }),
    db.user.findMany({
      where: { isActive: false },
      select: {
        id: true, name: true, email: true, role: true,
        jobTitle: true, department: true, location: true,
        avatar: true, managerId: true, isActive: true,
        manager: { select: { id: true, name: true } },
        projectMembers: {
          include: { project: { select: { id: true, name: true, status: true } } },
        },
      },
      orderBy: { name: "asc" },
    }),
    db.project.findMany({
      where: { status: { in: ["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED"] } },
      select: { id: true, name: true, status: true },
      orderBy: [{ status: "asc" }, { name: "asc" }],
    }),
    db.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div>
      <PageHeader
        title="Team"
        description="Organization chart, staffing, and employee overview"
        actions={canManage ? <AddEmployeeButton managers={allUsers} /> : undefined}
      />
      <TeamPageClient
        users={activeUsers as Parameters<typeof TeamPageClient>[0]["users"]}
        inactiveUsers={inactiveUsers as Parameters<typeof TeamPageClient>[0]["users"]}
        projects={projects}
        currentUserId={session.user.id}
      />
    </div>
  );
}
