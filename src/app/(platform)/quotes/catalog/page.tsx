import Link from "next/link";

import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Library } from "lucide-react";
import { formatCurrency } from "@/lib/quotes/totals";

import { CatalogTable } from "./catalog-table";

export default async function CatalogPage() {
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

  const items = await db.catalogItem.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });

  return (
    <div>
      <PageHeader
        title="Catalog"
        description="Reusable services and products that power line-item autocomplete"
        actions={
          <div className="flex items-center gap-3">
            <Link
              href="/quotes"
              className="text-sm text-muted-foreground hover:text-foreground hover:underline"
            >
              ← Back to quotes
            </Link>
          </div>
        }
      />

      {items.length === 0 ? (
        <EmptyState
          icon={Library}
          title="No catalog items yet"
          description="Add your most-used services and products so they autocomplete inside quotes"
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <CatalogTable
              items={items.map((i) => ({
                id: i.id,
                name: i.name,
                description: i.description,
                defaultUnitPrice: i.defaultUnitPrice,
                defaultUnit: i.defaultUnit,
                category: i.category,
                isRecurring: i.isRecurring,
                isActive: i.isActive,
                priceLabel: formatCurrency(i.defaultUnitPrice),
              }))}
              canEdit={perms.canEdit}
              canCreate={perms.canCreate}
              canDelete={perms.canDelete}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
