import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import Link from "next/link";
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
    },
  });

  if (!employee) notFound();

  const recentActivity = await db.activityLog.findMany({
    where: { userId: employeeId },
    take: 10,
    orderBy: { createdAt: "desc" },
  });

  const canManage = session.user.role === "ADMIN" || session.user.role === "MANAGER";

  // Serialize dates for client component
  const serializedEmployee = {
    ...employee,
    createdAt: employee.createdAt.toISOString(),
    updatedAt: employee.updatedAt.toISOString(),
    assignments: employee.assignments.map((a) => ({
      ...a,
      allocationFte: a.allocationFte,
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
      />
    </div>
  );
}
