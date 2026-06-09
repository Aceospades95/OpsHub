import Link from "next/link";

import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Mail } from "lucide-react";
import { format } from "date-fns";

import { EmailTemplateCreateButton } from "./email-template-create-button";

export default async function WorkflowEmailTemplatesPage() {
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

  const templates = await db.workflowEmailTemplate.findMany({
    orderBy: { updatedAt: "desc" },
    include: { createdBy: { select: { id: true, name: true } } },
  });

  return (
    <div>
      <PageHeader
        title="Workflow email templates"
        description="Reusable email bodies with {{variable}} substitution. Workflow steps reference these by id."
        actions={
          <div className="flex items-center gap-3">
            <Link
              href="/workflows"
              className="text-sm text-muted-foreground hover:text-foreground hover:underline"
            >
              ← Back
            </Link>
            {perms.canCreate && <EmailTemplateCreateButton />}
          </div>
        }
      />

      {templates.length === 0 ? (
        <EmptyState
          icon={Mail}
          title="No email templates"
          description="Create one to use in your workflows' send_email steps"
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Name</th>
                  <th className="px-4 py-3 text-left font-medium">Subject</th>
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
                        href={`/workflows/email-templates/${t.id}/edit`}
                        className="font-medium hover:text-primary hover:underline"
                      >
                        {t.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {t.subject}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
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
