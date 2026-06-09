import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { TeamPageClient } from "./team-page-client";
import { AddEmployeeButton } from "./add-employee-button";
import { ADMIN_SETTING_KEYS, getBooleanAdminSetting } from "@/lib/admin-settings";

export const metadata = { title: "Team · OpsHub" };

export default async function TeamPage() {
  const user = await requireAuth();

  const perms = await resolveModulePerms(user.id, user.role, "team");
  if (!perms.canView) return <AccessDenied module="team" moduleLabel="Team" moduleDescription="Employees, org chart, and staffing matrix" />;

  const canManage = user.role === "ADMIN" || user.role === "MANAGER";

  const [activeUsers, inactiveUsers, projects, clients, serviceOfferings, allUsers, roleDefinitions, projectRoles] = await Promise.all([
    db.user.findMany({
      where: { isActive: true },
      select: {
        id: true, name: true, email: true, role: true,
        jobTitle: true, department: true, location: true,
        avatar: true, managerId: true, isActive: true,
        manager: { select: { id: true, name: true } },
        directReports: { select: { id: true, name: true } },
        projectMembers: {
          include: { project: { select: { id: true, name: true, status: true, clientId: true } } },
        },
        assignments: {
          where: { status: { in: ["ACTIVE", "PLANNED"] } },
          include: {
            project: { select: { id: true, name: true, status: true } },
            client: { select: { id: true, name: true } },
            serviceOffering: { select: { id: true, name: true } },
            projectRole: { select: { id: true, roleDefinition: { select: { id: true, name: true } }, requiredFte: true } },
            roleDefinition: { select: { id: true, name: true } },
          },
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
        directReports: { select: { id: true, name: true } },
        projectMembers: {
          include: { project: { select: { id: true, name: true, status: true, clientId: true } } },
        },
        assignments: {
          where: { status: { in: ["ACTIVE", "PLANNED"] } },
          include: {
            project: { select: { id: true, name: true, status: true } },
            client: { select: { id: true, name: true } },
            serviceOffering: { select: { id: true, name: true } },
            projectRole: { select: { id: true, roleDefinition: { select: { id: true, name: true } }, requiredFte: true } },
            roleDefinition: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { name: "asc" },
    }),
    db.project.findMany({
      where: { status: { in: ["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED"] }, deletedAt: null },
      select: {
        id: true, name: true, status: true, clientId: true,
        serviceOfferingId: true,
        serviceOffering: { select: { id: true, name: true } },
      },
      orderBy: [{ status: "asc" }, { name: "asc" }],
    }),
    db.client.findMany({
      where: { status: "ACTIVE", deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.serviceOffering.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.roleDefinition.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.projectRole.findMany({
      select: {
        id: true, projectId: true, requiredFte: true, quantity: true,
        roleDefinition: { select: { id: true, name: true } },
        assignments: { select: { id: true, employeeId: true } },
      },
    }),
  ]);

  const defaultSendWelcomeEmail = canManage
    ? await getBooleanAdminSetting(ADMIN_SETTING_KEYS.sendWelcomeEmailDefault, true)
    : true;

  return (
    <div>
      <PageHeader
        title="Team"
        description="Organization chart, staffing, and employee overview"
        actions={
          canManage ? (
            <AddEmployeeButton
              managers={allUsers}
              defaultSendWelcomeEmail={defaultSendWelcomeEmail}
            />
          ) : undefined
        }
      />
      <TeamPageClient
        users={activeUsers as Parameters<typeof TeamPageClient>[0]["users"]}
        inactiveUsers={inactiveUsers as Parameters<typeof TeamPageClient>[0]["users"]}
        projects={projects}
        clients={clients}
        serviceOfferings={serviceOfferings}
        roleDefinitions={roleDefinitions}
        projectRoles={projectRoles}
        currentUserId={user.id}
        canManage={canManage}
      />
    </div>
  );
}
