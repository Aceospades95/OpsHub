import Link from "next/link";
import { notFound } from "next/navigation";
import { format, formatDistanceToNowStrict } from "date-fns";

import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { describeTiming } from "@/lib/workflows/timing";
import { STEP_TYPE_DEFINITIONS } from "@/lib/workflows/step-types";

import { InstanceActions, StepActions } from "./instance-actions";

const STATUS_VARIANT: Record<string, "default" | "success" | "warning" | "destructive" | "secondary" | "outline"> = {
  PENDING: "outline",
  IN_PROGRESS: "default",
  PAUSED: "warning",
  COMPLETED: "success",
  CANCELLED: "secondary",
  // Step statuses
  SCHEDULED: "outline",
  SKIPPED: "secondary",
  FAILED: "destructive",
};

interface Props {
  params: Promise<{ instanceId: string }>;
}

export default async function WorkflowInstanceDetailPage({ params }: Props) {
  const { instanceId } = await params;
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

  const instance = await db.workflowInstance.findUnique({
    where: { id: instanceId },
    include: {
      workflowTemplate: { select: { id: true, name: true, type: true } },
      createdBy: { select: { id: true, name: true } },
      steps: {
        orderBy: { workflowStep: { position: "asc" } },
        include: {
          workflowStep: true,
          completedByUser: { select: { id: true, name: true } },
        },
      },
      events: {
        orderBy: { createdAt: "desc" },
        take: 100,
      },
    },
  });
  if (!instance) notFound();

  // Subject lookup — only EMPLOYEE for now.
  const subjectName =
    instance.subjectType === "EMPLOYEE"
      ? (
          await db.user.findUnique({
            where: { id: instance.subjectId },
            select: { name: true },
          })
        )?.name ?? "(missing employee)"
      : `${instance.subjectType.toLowerCase()} ${instance.subjectId.slice(0, 8)}`;

  const totalSteps = instance.steps.length;
  const terminalSteps = instance.steps.filter((s) =>
    ["COMPLETED", "SKIPPED", "FAILED"].includes(s.status)
  ).length;
  const pct = totalSteps > 0 ? Math.round((terminalSteps / totalSteps) * 100) : 0;

  return (
    <div>
      <PageHeader
        title={`${instance.workflowTemplate.name} — ${subjectName}`}
        description={`Started ${format(instance.startDate, "MMM d, yyyy")}${instance.targetDate ? ` · target ${format(instance.targetDate, "MMM d, yyyy")}` : ""}`}
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/workflows/instances"
              className="text-sm text-muted-foreground hover:text-foreground hover:underline"
            >
              ← Back
            </Link>
            <InstanceActions
              instanceId={instance.id}
              status={instance.status}
              canEdit={perms.canEdit}
            />
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle>Progress</CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    {terminalSteps}/{totalSteps} steps · {pct}% complete
                  </p>
                </div>
                <Badge variant={STATUS_VARIANT[instance.status] ?? "outline"}>
                  {instance.status.replace(/_/g, " ").toLowerCase()}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-2 rounded-full bg-muted overflow-hidden mb-6">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>

              <ol className="relative border-l border-border pl-6 space-y-3">
                {instance.steps.map((step, i) => {
                  const def = STEP_TYPE_DEFINITIONS.find(
                    (d) => d.type === step.workflowStep.stepType
                  );
                  return (
                    <li key={step.id} className="relative">
                      <span className="absolute -left-[26px] top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                        {i + 1}
                      </span>
                      <div className="rounded border border-border bg-muted/30 p-3 space-y-2">
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div className="min-w-0">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">
                              {def?.label ?? step.workflowStep.stepType}
                            </p>
                            <p className="font-medium">{step.workflowStep.name}</p>
                            <div className="flex flex-wrap gap-1 mt-1">
                              <Badge
                                variant={STATUS_VARIANT[step.status] ?? "outline"}
                                className="text-[10px]"
                              >
                                {step.status.replace(/_/g, " ").toLowerCase()}
                              </Badge>
                              <Badge variant="outline" className="text-[10px]">
                                {describeTiming(
                                  step.workflowStep.timingType,
                                  step.workflowStep.timingValue,
                                  step.workflowStep.afterStepId != null
                                )}
                              </Badge>
                              {!step.workflowStep.isRequired && (
                                <Badge variant="outline" className="text-[10px]">
                                  Optional
                                </Badge>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground mt-1.5 space-y-0.5">
                              {step.scheduledFor && (
                                <p>
                                  Scheduled for{" "}
                                  {format(step.scheduledFor, "MMM d, yyyy h:mm a")}
                                </p>
                              )}
                              {step.completedAt && (
                                <p>
                                  {step.status === "COMPLETED"
                                    ? "Completed"
                                    : step.status === "SKIPPED"
                                      ? "Skipped"
                                      : step.status === "FAILED"
                                        ? "Failed"
                                        : "Closed"}
                                  {" "}
                                  {formatDistanceToNowStrict(step.completedAt, { addSuffix: true })}
                                  {step.completedByUser && (
                                    <> by{" "}
                                      <Link
                                        href={`/team/${step.completedByUser.id}`}
                                        className="hover:text-primary hover:underline"
                                      >
                                        {step.completedByUser.name}
                                      </Link>
                                    </>
                                  )}
                                </p>
                              )}
                              {step.error && (
                                <p className="text-destructive">
                                  Error: {step.error}
                                </p>
                              )}
                            </div>
                          </div>
                          <StepActions
                            instanceStepId={step.id}
                            status={step.status}
                            stepType={step.workflowStep.stepType}
                            canEdit={perms.canEdit}
                          />
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Subject</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              <p>
                <span className="text-muted-foreground">Type:</span>{" "}
                {instance.subjectType.toLowerCase()}
              </p>
              {instance.subjectType === "EMPLOYEE" ? (
                <p>
                  <Link
                    href={`/team/${instance.subjectId}`}
                    className="font-medium hover:text-primary hover:underline"
                  >
                    {subjectName}
                  </Link>
                </p>
              ) : (
                <p className="font-mono text-xs">{instance.subjectId}</p>
              )}
              <p className="text-xs text-muted-foreground border-t border-border pt-2">
                Created by{" "}
                <Link
                  href={`/team/${instance.createdBy.id}`}
                  className="hover:text-primary hover:underline"
                >
                  {instance.createdBy.name}
                </Link>{" "}
                {formatDistanceToNowStrict(instance.createdAt, { addSuffix: true })}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Activity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {instance.events.length === 0 ? (
                <p className="text-muted-foreground">No activity yet.</p>
              ) : (
                instance.events.map((e) => (
                  <div key={e.id} className="text-xs border-b border-border pb-1.5 last:border-0">
                    <p className="font-medium capitalize">
                      {e.eventType.replace(/_/g, " ")}
                    </p>
                    <p className="text-muted-foreground">
                      {format(e.createdAt, "MMM d, yyyy h:mm a")}
                    </p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
