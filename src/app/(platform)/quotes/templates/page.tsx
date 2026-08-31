import Link from "next/link";

import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FileBox } from "lucide-react";

import { TemplatesList } from "./templates-list";

export default async function TemplatesPage() {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "quotes");
  if (!perms.canView) {
    return (
      <AccessDenied
        module="quotes"
        moduleLabel="Quotes"
        moduleDescription="Sales quotes, line-item builder, templates, and catalog"
      />
    );
  }

  const [templates, clients] = await Promise.all([
    db.quoteTemplate.findMany({
      orderBy: { updatedAt: "desc" },
      include: {
        createdBy: { select: { id: true, name: true } },
        _count: { select: { lineItems: true } },
      },
    }),
    db.client.findMany({
      where: { status: { in: ["ACTIVE", "PROSPECT"] }, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div>
      <PageHeader
        title="Quote templates"
        description="Save common service bundles so you're not rebuilding from scratch every time"
        actions={
          <Link
            href="/quotes"
            className="text-sm text-muted-foreground hover:text-foreground hover:underline"
          >
            ← Back to quotes
          </Link>
        }
      />

      {templates.length === 0 ? (
        <EmptyState
          icon={FileBox}
          title="No templates yet"
          description="Save any quote as a template from the quote actions menu"
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <TemplatesList
              templates={templates.map((t) => ({
                id: t.id,
                name: t.name,
                description: t.description,
                variantOfId: t.variantOfId,
                variantLabel: t.variantLabel,
                lineItemCount: t._count.lineItems,
                createdByName: t.createdBy.name,
                createdById: t.createdBy.id,
                updatedAt: t.updatedAt.toISOString(),
              }))}
              clients={clients}
              canCreate={perms.canCreate}
              canEdit={perms.canEdit}
              canDelete={perms.canDelete}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
