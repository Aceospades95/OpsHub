import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { PageHeader } from "@/components/layout/page-header";
import { EmployeeDetailClient } from "./employee-detail-client";
import { StartWorkflowButton } from "./start-workflow-button";

interface Props {
  params: Promise<{ employeeId: string }>;
}

export default async function EmployeeDetailPage({ params }: Props) {
  const { employeeId } = await params;
  const user = await requireAuth();

  const employee = await db.user.findUnique({
    where: { id: employeeId },
    include: {
      manager: { select: { id: true, name: true, jobTitle: true, avatar: true } },
      directReports: {
        where: { isActive: true },
        select: { id: true, name: true, email: true, role: true, jobTitle: true, avatar: true },
        orderBy: { name: "asc" },
      },
      projectMembers: {
        include: {
          project: {
            select: { id: true, name: true, status: true, client: { select: { id: true, name: true } } },
          },
        },
      },
      assignments: {
        include: {
          project: { select: { id: true, name: true, status: true } },
          client: { select: { id: true, name: true } },
          serviceOffering: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      modulePermissions: true,
      entityPermissions: true,
      accounts: {
        select: { id: true, provider: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!employee) notFound();

  const canManage = user.role === "ADMIN" || user.role === "MANAGER";
  const isAdmin = user.role === "ADMIN";

  // Fetch admin-related data
  const [recentActivity, allUsers, allClients, allProjects, serviceOfferings, roleDefinitions, customPages] = await Promise.all([
    db.activityLog.findMany({
      where: { userId: employeeId },
      take: 10,
      orderBy: { createdAt: "desc" },
    }),
    canManage ? db.user.findMany({
      where: { id: { not: employeeId }, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }) : Promise.resolve([]),
    db.client.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.project.findMany({
      where: { status: { in: ["PLANNING", "ACTIVE", "ON_HOLD"] } },
      select: {
        id: true, name: true, status: true, clientId: true,
        serviceOfferingId: true,
        serviceOffering: { select: { id: true, name: true } },
      },
      orderBy: { name: "asc" },
    }),
    db.serviceOffering.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.roleDefinition.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    isAdmin
      ? db.sandboxPage.findMany({
          where: { published: true },
          select: { id: true, title: true, slug: true },
          orderBy: { title: "asc" },
        })
      : Promise.resolve([]),
  ]);

  // Serialize dates for client component
  const serializedEmployee = {
    ...employee,
    hashedPassword: undefined, // never send to client
    createdAt: employee.createdAt.toISOString(),
    updatedAt: employee.updatedAt.toISOString(),
    assignments: employee.assignments.map((a) => ({
      ...a,
      startDate: a.startDate?.toISOString() || null,
      endDate: a.endDate?.toISOString() || null,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
    })),
    projectMembers: employee.projectMembers.map((pm) => ({
      ...pm,
      createdAt: pm.createdAt.toISOString(),
    })),
    accounts: employee.accounts.map((a) => ({
      ...a,
      createdAt: a.createdAt.toISOString(),
    })),
  };

  const serializedActivity = recentActivity.map((a) => ({
    ...a,
    createdAt: a.createdAt.toISOString(),
  }));

  // Workflow templates available to start manually for this employee.
  // Only EMPLOYEE-subject + active templates are shown — no point listing
  // a candidate-hire template against a sitting team member.
  const workflowsPerms = await resolveModulePerms(user.id, user.role, "workflows");
  const workflowTemplates = workflowsPerms.canCreate
    ? await db.workflowTemplate.findMany({
        where: {
          isActive: true,
          subjectEntityType: "EMPLOYEE",
        },
        orderBy: [{ isSeed: "desc" }, { name: "asc" }],
        select: { id: true, name: true, type: true },
      })
    : [];

  return (
    <div>
      <PageHeader
        title={employee.name}
        description={[employee.jobTitle, employee.department].filter(Boolean).join(" · ") || employee.email}
        actions={
          workflowTemplates.length > 0 ? (
            <StartWorkflowButton
              employeeId={employee.id}
              templates={workflowTemplates}
            />
          ) : undefined
        }
      />
      <EmployeeDetailClient
        employee={serializedEmployee}
        activity={serializedActivity}
        canManage={canManage}
        isAdmin={isAdmin}
        allUsers={allUsers}
        allClients={allClients}
        allProjects={allProjects}
        serviceOfferings={serviceOfferings}
        roleDefinitions={roleDefinitions}
        customPages={customPages}
      />
    </div>
  );
}
