import Link from "next/link";

import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PlayCircle } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
import { formatCalendarDate } from "@/lib/dates";

const STATUS_VARIANT: Record<string, "default" | "success" | "warning" | "destructive" | "secondary" | "outline"> = {
  PENDING: "outline",
  IN_PROGRESS: "default",
  PAUSED: "warning",
  COMPLETED: "success",
  CANCELLED: "secondary",
};

export default async function WorkflowInstancesPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "workflows");
  if (!perms.canView) {
    return (
      <AccessDenied
        module="workflows"
        moduleLabel="Workflows"
        moduleDescription="Automated onboarding, offboarding, and hiring sequences"
      />
    );
  }

  const filter = searchParams.status?.toUpperCase();
  const statusFilter =
    filter && ["PENDING", "IN_PROGRESS", "PAUSED", "COMPLETED", "CANCELLED"].includes(filter)
      ? filter
      : undefined;

  const instances = await db.workflowInstance.findMany({
    where: statusFilter
      ? { status: statusFilter as "PENDING" | "IN_PROGRESS" | "PAUSED" | "COMPLETED" | "CANCELLED" }
      : { status: { in: ["PENDING", "IN_PROGRESS", "PAUSED"] } },
    orderBy: { startDate: "desc" },
    include: {
      workflowTemplate: { select: { id: true, name: true, type: true } },
      _count: { select: { steps: true } },
    },
    take: 200,
  });

  // Compute progress per instance with one batched query so we don't
  // N+1 the per-row terminal-count.
  const instanceIds = instances.map((i) => i.id);
  const stepCounts = instanceIds.length
    ? await db.workflowInstanceStep.groupBy({
        by: ["workflowInstanceId", "status"],
        where: { workflowInstanceId: { in: instanceIds } },
        _count: { _all: true },
      })
    : [];
  const progressMap = new Map<string, { terminal: number; total: number }>();
  for (const id of instanceIds) progressMap.set(id, { terminal: 0, total: 0 });
  for (const row of stepCounts) {
    const p = progressMap.get(row.workflowInstanceId)!;
    p.total += row._count._all;
    if (
      row.status === "COMPLETED" ||
      row.status === "SKIPPED" ||
      row.status === "FAILED"
    ) {
      p.terminal += row._count._all;
    }
  }

  // Resolve subject names for the EMPLOYEE rows so the dashboard reads
  // human-friendly. Other subject types stay as ids until Phase 5.
  const employeeIds = instances
    .filter((i) => i.subjectType === "EMPLOYEE")
    .map((i) => i.subjectId);
  const employees = employeeIds.length
    ? await db.user.findMany({
        where: { id: { in: employeeIds } },
        select: { id: true, name: true },
      })
    : [];
  const employeeMap = new Map(employees.map((e) => [e.id, e.name]));

  return (
    <div>
      <PageHeader
        title="Running workflows"
        description="In-flight onboarding, offboarding, and hiring sequences"
        actions={
          <Link
            href="/workflows"
            className="text-sm text-muted-foreground hover:text-foreground hover:underline"
          >
            ← Back
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <FilterPill href="/workflows/instances" active={!statusFilter}>
          Active
        </FilterPill>
        <FilterPill
          href="/workflows/instances?status=PAUSED"
          active={statusFilter === "PAUSED"}
        >
          Paused
        </FilterPill>
        <FilterPill
          href="/workflows/instances?status=COMPLETED"
          active={statusFilter === "COMPLETED"}
        >
          Completed
        </FilterPill>
        <FilterPill
          href="/workflows/instances?status=CANCELLED"
          active={statusFilter === "CANCELLED"}
        >
          Cancelled
        </FilterPill>
      </div>

      {instances.length === 0 ? (
        <EmptyState
          icon={PlayCircle}
          title="No running workflows"
          description="Start one from a template, or create a new employee to fire any auto-trigger templates"
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {instances.map((inst) => {
            const progress = progressMap.get(inst.id) ?? { terminal: 0, total: 0 };
            const pct =
              progress.total > 0
                ? Math.round((progress.terminal / progress.total) * 100)
                : 0;
            const subjectName =
              inst.subjectType === "EMPLOYEE"
                ? employeeMap.get(inst.subjectId) ?? "(missing employee)"
                : `${inst.subjectType.toLowerCase()} ${inst.subjectId.slice(0, 8)}`;
            return (
              <Link key={inst.id} href={`/workflows/instances/${inst.id}`}>
                <Card className="hover:shadow-md transition-shadow h-full">
                  <CardContent className="p-5 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground">
                          {inst.workflowTemplate.name}
                        </p>
                        <p className="font-semibold text-foreground truncate">
                          {subjectName}
                        </p>
                      </div>
                      <Badge variant={STATUS_VARIANT[inst.status] ?? "outline"}>
                        {inst.status.replace(/_/g, " ").toLowerCase()}
                      </Badge>
                    </div>
                    <div>
                      <div className="flex justify-between text-xs text-muted-foreground mb-1">
                        <span>
                          {progress.terminal}/{progress.total} steps
                        </span>
                        <span>{pct}%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-primary transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Started {formatDistanceToNowStrict(inst.startDate, { addSuffix: true })}
                      {inst.targetDate && (
                        <> · target {formatCalendarDate(inst.targetDate, "MMM d")}</>
                      )}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FilterPill({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
        active
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-muted-foreground hover:bg-border"
      }`}
    >
      {children}
    </Link>
  );
}
