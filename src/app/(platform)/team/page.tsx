import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/layout/page-header";
import { TeamPageClient } from "./team-page-client";

export default async function TeamPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [users, projects] = await Promise.all([
    db.user.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        jobTitle: true,
        department: true,
        avatar: true,
        managerId: true,
        isActive: true,
        manager: { select: { id: true, name: true } },
        projectMembers: {
          include: {
            project: { select: { id: true, name: true, status: true } },
          },
        },
      },
      orderBy: { name: "asc" },
    }),
    db.project.findMany({
      where: { status: { in: ["PLANNING", "ACTIVE", "ON_HOLD"] } },
      select: { id: true, name: true, status: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div>
      <PageHeader
        title="Team"
        description="Organization chart, staffing, and employee overview"
      />
      <TeamPageClient
        users={users as Parameters<typeof TeamPageClient>[0]["users"]}
        projects={projects}
        currentUserId={session.user.id}
      />
    </div>
  );
}
