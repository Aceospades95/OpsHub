import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/layout/page-header";
import { EmployeeDetailClient } from "./employee-detail-client";

interface Props {
  params: Promise<{ employeeId: string }>;
}

export default async function EmployeeDetailPage({ params }: Props) {
  const { employeeId } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");

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
    },
  });

  if (!employee) notFound();

  const canManage = session.user.role === "ADMIN" || session.user.role === "MANAGER";
  const isAdmin = session.user.role === "ADMIN";
  // Files tab is visible to self, manager, admin — same gate used in the
  // employee-files server action.
  const isSelf = session.user.id === employeeId;
  const canViewFiles = isSelf || canManage;

  // Only fetch files when the viewer is allowed to see them. Avoids leaking
  // file metadata to viewers who can't open the bytes anyway.
  const profileFiles = canViewFiles
    ? await db.file.findMany({
        where: { userId: employeeId },
        orderBy: { createdAt: "desc" },
        include: { uploadedBy: { select: { id: true, name: true } } },
      })
    : [];

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
  };

  const serializedActivity = recentActivity.map((a) => ({
    ...a,
    createdAt: a.createdAt.toISOString(),
  }));

  const serializedFiles = profileFiles.map((f) => ({
    id: f.id,
    name: f.name,
    url: f.url,
    size: f.size,
    mimeType: f.mimeType,
    category: f.category,
    createdAt: f.createdAt.toISOString(),
    uploadedBy: f.uploadedBy ? { id: f.uploadedBy.id, name: f.uploadedBy.name } : null,
  }));

  return (
    <div>
      <PageHeader
        title={employee.name}
        description={[employee.jobTitle, employee.department].filter(Boolean).join(" · ") || employee.email}
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
        files={serializedFiles}
        canViewFiles={canViewFiles}
        customPages={customPages}
      />
    </div>
  );
}
