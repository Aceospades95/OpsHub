import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { activityVisibilityWhere } from "@/lib/activity";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { EmployeeDetailClient } from "./employee-detail-client";
import { StartWorkflowButton } from "./start-workflow-button";
import { RecentlyViewedTracker } from "@/components/shared/recently-viewed-tracker";

interface Props {
  params: Promise<{ employeeId: string }>;
}

export default async function EmployeeDetailPage({ params }: Props) {
  const { employeeId } = await params;
  const user = await requireAuth();

  const teamPerms = await resolveModulePerms(user.id, user.role, "team");
  if (!teamPerms.canView) return <AccessDenied module="team" moduleLabel="Team" moduleDescription="Employees, org chart, and staffing matrix" />;

  const canManage = user.role === "ADMIN" || user.role === "MANAGER";
  const isAdmin = user.role === "ADMIN";
  // HR-sensitive, and never shown to the report's subject: an
  // ADMIN/MANAGER viewing their OWN profile doesn't get the tab (or the
  // data) — the server actions enforce the same rule.
  const canManageDisciplinary = canManage && user.id !== employeeId;

  // Explicit select of exactly what EmployeeDetailClient renders — the
  // previous full-row include sent every column (incl. permission rows
  // and OAuth accounts) to every viewer. The permissions/accounts
  // relations are only fetched for admins, who are the only viewers the
  // client shows the Permissions tab (and the linked-account controls) to.
  const employee = await db.user.findUnique({
    where: { id: employeeId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      jobTitle: true,
      department: true,
      location: true,
      phone: true,
      avatar: true,
      isActive: true,
      hasLoginAccess: true,
      authProvider: true,
      managerId: true,
      terminationDate: true,
      createdAt: true,
      manager: { select: { id: true, name: true, jobTitle: true, avatar: true } },
      directReports: {
        where: { isActive: true },
        select: { id: true, name: true, email: true, role: true, jobTitle: true, avatar: true },
        orderBy: { name: "asc" },
      },
      projectMembers: {
        select: {
          id: true,
          role: true,
          createdAt: true,
          project: {
            select: { id: true, name: true, status: true, client: { select: { id: true, name: true } } },
          },
        },
      },
      assignments: {
        select: {
          id: true,
          allocationFte: true,
          status: true,
          role: true,
          function: true,
          notes: true,
          startDate: true,
          endDate: true,
          createdAt: true,
          project: { select: { id: true, name: true, status: true } },
          client: { select: { id: true, name: true } },
          serviceOffering: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!employee) notFound();

  // Permission rows + OAuth accounts only exist in the UI for admins
  // (Permissions tab, Google-unlink, reset-password) — don't even query
  // them for other viewers.
  const [modulePermissions, entityPermissions, accounts] = isAdmin
    ? await Promise.all([
        db.modulePermission.findMany({ where: { userId: employeeId } }),
        db.entityPermission.findMany({ where: { userId: employeeId } }),
        db.account.findMany({
          where: { userId: employeeId },
          select: { id: true, provider: true, createdAt: true },
          orderBy: { createdAt: "desc" },
        }),
      ])
    : [[], [], []];

  // Admin-only data — the client only uses these in the canManage /
  // isAdmin gated dialogs and the Permissions tab.
  const [recentActivity, disciplinaryReports, allUsers, allClients, allProjects, serviceOfferings, roleDefinitions, customPages] = await Promise.all([
    db.activityLog.findMany({
      // Rows where this employee is the ACTOR. HR-sensitive entity
      // types are filtered for viewers outside the HR roles.
      where: { userId: employeeId, ...activityVisibilityWhere(user.role) },
      take: 10,
      orderBy: { createdAt: "desc" },
    }),
    canManageDisciplinary
      ? db.disciplinaryReport.findMany({
          where: { employeeId, deletedAt: null },
          orderBy: { incidentDate: "desc" },
          include: { issuedBy: { select: { name: true } } },
        })
      : Promise.resolve([]),
    canManage ? db.user.findMany({
      where: { id: { not: employeeId }, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }) : Promise.resolve([]),
    canManage
      ? db.client.findMany({ where: { status: "ACTIVE", deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } })
      : Promise.resolve([]),
    canManage
      ? db.project.findMany({
          where: { status: { in: ["PLANNING", "ACTIVE", "ON_HOLD"] }, deletedAt: null },
          select: {
            id: true, name: true, status: true, clientId: true,
            serviceOfferingId: true,
            serviceOffering: { select: { id: true, name: true } },
          },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
    canManage
      ? db.serviceOffering.findMany({
          where: { isActive: true },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
    canManage
      ? db.roleDefinition.findMany({
          where: { isActive: true },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
    isAdmin
      ? db.sandboxPage.findMany({
          where: { published: true },
          select: { id: true, title: true, slug: true },
          orderBy: { title: "asc" },
        })
      : Promise.resolve([]),
  ]);

  // Serialize dates for client component. Permission rows + OAuth
  // accounts only go over the wire for admins (the only viewers the
  // client shows them to); everyone else gets empty arrays.
  const serializedEmployee = {
    ...employee,
    createdAt: employee.createdAt.toISOString(),
    // HR-sensitive — only the ADMIN/MANAGER viewers who get the edit
    // dialog receive the real value; everyone else gets null.
    terminationDate: canManage
      ? employee.terminationDate?.toISOString() || null
      : null,
    assignments: employee.assignments.map((a) => ({
      ...a,
      startDate: a.startDate?.toISOString() || null,
      endDate: a.endDate?.toISOString() || null,
      createdAt: a.createdAt.toISOString(),
    })),
    projectMembers: employee.projectMembers.map((pm) => ({
      ...pm,
      createdAt: pm.createdAt.toISOString(),
    })),
    modulePermissions,
    entityPermissions,
    accounts: accounts.map((a) => ({
      ...a,
      createdAt: a.createdAt.toISOString(),
    })),
  };

  const serializedActivity = recentActivity.map((a) => ({
    ...a,
    createdAt: a.createdAt.toISOString(),
  }));

  const serializedDisciplinaryReports = disciplinaryReports.map((report) => ({
    id: report.id,
    actionType: report.actionType as string,
    incidentDate: report.incidentDate.toISOString(),
    createdAt: report.createdAt.toISOString(),
    followUpDate: report.followUpDate ? report.followUpDate.toISOString() : null,
    acknowledgedAt: report.acknowledgedAt ? report.acknowledgedAt.toISOString() : null,
    description: report.description,
    actionTaken: report.actionTaken,
    improvementPlan: report.improvementPlan,
    witnesses: report.witnesses,
    notes: report.notes,
    issuedByName: report.issuedBy.name,
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
      <RecentlyViewedTracker
        type="employee"
        id={employee.id}
        label={employee.name}
        sublabel={employee.jobTitle || employee.department || undefined}
        href={`/team/${employee.id}`}
      />
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
        disciplinaryReports={serializedDisciplinaryReports}
        canManageDisciplinary={canManageDisciplinary}
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
