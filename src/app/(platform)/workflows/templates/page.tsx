import Link from "next/link";

import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { FileText } from "lucide-react";
import { format } from "date-fns";

import { WorkflowTemplateCreateButton } from "./template-create-button";

const TYPE_LABEL: Record<string, string> = {
  ONBOARDING: "Onboarding",
  OFFBOARDING: "Offboarding",
  CUSTOM: "Custom",
};

export default async function WorkflowTemplatesPage({
  searchParams,
}: {
  searchParams: { type?: string; archived?: string };
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

  const typeFilter = ["ONBOARDING", "OFFBOARDING", "CUSTOM"].includes(
    searchParams.type ?? ""
  )
    ? (searchParams.type as "ONBOARDING" | "OFFBOARDING" | "CUSTOM")
    : undefined;
  const showArchived = searchParams.archived === "1";

  const templates = await db.workflowTemplate.findMany({
    where: {
      ...(typeFilter ? { type: typeFilter } : {}),
      ...(showArchived ? {} : { isActive: true }),
    },
    orderBy: [{ isSeed: "desc" }, { updatedAt: "desc" }],
    include: {
      createdBy: { select: { id: true, name: true } },
      _count: { select: { steps: true, instances: true } },
    },
  });

  return (
    <div>
      <PageHeader
        title="Workflow templates"
        description="Reusable step sequences. Edit a template once and run it many times."
        actions={
          <div className="flex items-center gap-3">
            <Link
              href="/workflows"
              className="text-sm text-muted-foreground hover:text-foreground hover:underline"
            >
              ← Back
            </Link>
            {perms.canCreate && <WorkflowTemplateCreateButton />}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <FilterPill href="/workflows/templates" active={!typeFilter}>
          All
        </FilterPill>
        <FilterPill
          href="/workflows/templates?type=ONBOARDING"
          active={typeFilter === "ONBOARDING"}
        >
          Onboarding
        </FilterPill>
        <FilterPill
          href="/workflows/templates?type=OFFBOARDING"
          active={typeFilter === "OFFBOARDING"}
        >
          Offboarding
        </FilterPill>
        <FilterPill
          href="/workflows/templates?type=CUSTOM"
          active={typeFilter === "CUSTOM"}
        >
          Custom
        </FilterPill>
        <span className="text-border mx-1">|</span>
        <Link
          href={
            showArchived ? "/workflows/templates" : "/workflows/templates?archived=1"
          }
          className="text-xs text-primary hover:underline"
        >
          {showArchived ? "Hide archived" : "Show archived"}
        </Link>
      </div>

      {templates.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No templates"
          description="Create your first workflow template to get started"
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Name</th>
                    <th className="px-4 py-3 text-left font-medium">Type</th>
                    <th className="px-4 py-3 text-left font-medium">Subject</th>
                    <th className="px-4 py-3 text-right font-medium">Steps</th>
                    <th className="px-4 py-3 text-right font-medium">Running</th>
                    <th className="px-4 py-3 text-left font-medium">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {templates.map((t) => (
                    <tr
                      key={t.id}
                      className="border-t border-border hover:bg-muted/40 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/workflows/templates/${t.id}/edit`}
                          className="font-medium hover:text-primary hover:underline"
                        >
                          {t.name}
                        </Link>
                        {t.description && (
                          <p className="text-xs text-muted-foreground line-clamp-1">
                            {t.description}
                          </p>
                        )}
                        <div className="flex flex-wrap gap-1 mt-1">
                          {t.isSeed && (
                            <Badge variant="secondary" className="text-[10px]">
                              System
                            </Badge>
                          )}
                          {!t.isActive && (
                            <Badge variant="outline" className="text-[10px]">
                              Archived
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {TYPE_LABEL[t.type] ?? t.type}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {t.subjectEntityType.toLowerCase()}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {t._count.steps}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                        {t._count.instances}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {format(t.updatedAt, "MMM d, yyyy")}
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
