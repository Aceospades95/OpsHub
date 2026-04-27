import Link from "next/link";
import { format } from "date-fns";

import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { UserPlus } from "lucide-react";

import { CandidateCreateButton } from "./candidate-create-button";

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

const STAGE_VARIANT: Record<string, "default" | "success" | "secondary" | "outline" | "warning" | "destructive"> = {
  APPLIED: "outline",
  PHONE_SCREEN: "default",
  TECHNICAL_INTERVIEW: "default",
  OFFER: "warning",
  OFFER_ACCEPTED: "success",
  HIRED: "success",
  REJECTED: "destructive",
  WITHDRAWN: "secondary",
};

export default async function CandidatesPage({
  searchParams,
}: {
  searchParams: { stage?: string };
}) {
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

  const validStages = Object.keys(STAGE_LABEL);
  const stageFilter =
    searchParams.stage && validStages.includes(searchParams.stage)
      ? (searchParams.stage as keyof typeof STAGE_LABEL)
      : undefined;

  const candidates = await db.candidate.findMany({
    where: stageFilter
      ? { stage: stageFilter as never }
      : undefined,
    orderBy: { createdAt: "desc" },
    include: {
      createdBy: { select: { id: true, name: true } },
      convertedUser: { select: { id: true, name: true } },
    },
  });

  return (
    <div>
      <PageHeader
        title="Candidates"
        description="Applicants moving through the hiring workflow"
        actions={perms.canCreate ? <CandidateCreateButton /> : undefined}
      />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <FilterPill href="/candidates" active={!stageFilter}>
          All
        </FilterPill>
        {validStages.map((s) => (
          <FilterPill
            key={s}
            href={`/candidates?stage=${s}`}
            active={stageFilter === s}
          >
            {STAGE_LABEL[s]}
          </FilterPill>
        ))}
      </div>

      {candidates.length === 0 ? (
        <EmptyState
          icon={UserPlus}
          title="No candidates"
          description={
            stageFilter
              ? `No candidates in the ${STAGE_LABEL[stageFilter]} stage.`
              : "Add your first candidate to start tracking applicants."
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Name</th>
                    <th className="px-4 py-3 text-left font-medium">Position</th>
                    <th className="px-4 py-3 text-left font-medium">Stage</th>
                    <th className="px-4 py-3 text-left font-medium">Applied</th>
                    <th className="px-4 py-3 text-left font-medium">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((c) => (
                    <tr
                      key={c.id}
                      className="border-t border-border hover:bg-muted/40 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/candidates/${c.id}`}
                          className="font-medium hover:text-primary hover:underline"
                        >
                          {c.firstName} {c.lastName}
                        </Link>
                        <p className="text-xs text-muted-foreground">{c.email}</p>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {c.position ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={STAGE_VARIANT[c.stage] ?? "outline"}>
                          {STAGE_LABEL[c.stage] ?? c.stage}
                        </Badge>
                        {c.convertedUser && (
                          <Link
                            href={`/team/${c.convertedUser.id}`}
                            className="block text-[10px] text-primary hover:underline mt-1"
                          >
                            → {c.convertedUser.name}
                          </Link>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {format(c.createdAt, "MMM d, yyyy")}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {c.source ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
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
