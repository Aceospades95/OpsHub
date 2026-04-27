import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";

import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

import { StageSelector } from "./stage-selector";
import { StartCandidateWorkflowButton } from "./start-workflow-button";

interface Props {
  params: Promise<{ candidateId: string }>;
}

const STAGE_LABEL: Record<string, string> = {
  APPLIED: "Applied",
  PHONE_SCREEN: "Phone screen",
  TECHNICAL_INTERVIEW: "Technical interview",
  OFFER: "Offer extended",
  OFFER_ACCEPTED: "Offer accepted",
  HIRED: "Hired",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
};

export default async function CandidateDetailPage({ params }: Props) {
  const { candidateId } = await params;
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "candidates");
  if (!perms.canView) {
    return (
      <AccessDenied
        module="candidates"
        moduleLabel="Candidates"
        moduleDescription="Applicants progressing through the hiring workflow"
      />
    );
  }

  const candidate = await db.candidate.findUnique({
    where: { id: candidateId },
    include: {
      createdBy: { select: { id: true, name: true } },
      convertedUser: { select: { id: true, name: true } },
    },
  });
  if (!candidate) notFound();

  // Find any workflow instances targeting this candidate so the page
  // shows what's running for them.
  const instances = await db.workflowInstance.findMany({
    where: {
      subjectType: "CANDIDATE",
      subjectId: candidate.id,
    },
    include: {
      workflowTemplate: { select: { id: true, name: true } },
    },
    orderBy: { startDate: "desc" },
  });

  // Workflow templates available to start manually for this candidate.
  const workflowsPerms = await resolveModulePerms(user.id, user.role, "workflows");
  const workflowTemplates = workflowsPerms.canCreate
    ? await db.workflowTemplate.findMany({
        where: {
          isActive: true,
          subjectEntityType: "CANDIDATE",
        },
        orderBy: [{ isSeed: "desc" }, { name: "asc" }],
        select: { id: true, name: true, type: true },
      })
    : [];

  return (
    <div>
      <PageHeader
        title={`${candidate.firstName} ${candidate.lastName}`}
        description={[candidate.position, candidate.email]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/candidates"
              className="text-sm text-muted-foreground hover:text-foreground hover:underline"
            >
              ← Back
            </Link>
            {workflowTemplates.length > 0 && (
              <StartCandidateWorkflowButton
                candidateId={candidate.id}
                templates={workflowTemplates}
              />
            )}
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between">
                <CardTitle>Overview</CardTitle>
                <StageSelector
                  candidateId={candidate.id}
                  stage={candidate.stage}
                  canEdit={perms.canEdit}
                />
              </div>
            </CardHeader>
            <CardContent className="text-sm space-y-3">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    Email
                  </dt>
                  <dd className="mt-1">{candidate.email}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    Phone
                  </dt>
                  <dd className="mt-1 text-muted-foreground">
                    {candidate.phone ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    Position
                  </dt>
                  <dd className="mt-1">{candidate.position ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    Source
                  </dt>
                  <dd className="mt-1 text-muted-foreground">
                    {candidate.source ?? "—"}
                  </dd>
                </div>
              </dl>
              {candidate.resumeUrl && (
                <p className="pt-3 border-t border-border">
                  <a
                    href={candidate.resumeUrl}
                    target="_blank"
                    rel="noopener"
                    className="text-primary hover:underline text-sm"
                  >
                    View resume →
                  </a>
                </p>
              )}
              {candidate.notes && (
                <div className="pt-3 border-t border-border">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                    Notes
                  </p>
                  <p className="whitespace-pre-wrap">{candidate.notes}</p>
                </div>
              )}
              {candidate.convertedUser && (
                <p className="pt-3 border-t border-border text-emerald-700">
                  Converted to employee:{" "}
                  <Link
                    href={`/team/${candidate.convertedUser.id}`}
                    className="font-medium hover:underline"
                  >
                    {candidate.convertedUser.name}
                  </Link>
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Workflow instances ({instances.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {instances.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No workflows running for this candidate yet.
                </p>
              ) : (
                <ul className="space-y-2">
                  {instances.map((i) => (
                    <li key={i.id}>
                      <Link
                        href={`/workflows/instances/${i.id}`}
                        className="block rounded border border-border bg-muted/30 p-3 hover:border-primary transition-colors"
                      >
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <p className="font-medium text-sm">
                            {i.workflowTemplate.name}
                          </p>
                          <Badge variant="outline" className="text-[10px]">
                            {i.status.toLowerCase().replace(/_/g, " ")}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Started {format(i.startDate, "MMM d, yyyy")}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div>
          <Card>
            <CardHeader>
              <CardTitle>Created</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-1.5">
              <p>
                <Link
                  href={`/team/${candidate.createdBy.id}`}
                  className="font-medium hover:text-primary hover:underline"
                >
                  {candidate.createdBy.name}
                </Link>
              </p>
              <p className="text-xs text-muted-foreground">
                {format(candidate.createdAt, "MMM d, yyyy")}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
