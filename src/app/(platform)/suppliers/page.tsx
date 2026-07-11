import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Truck, Star, Mail, Phone, MapPin } from "lucide-react";
import Link from "next/link";
import { SupplierCreateButton } from "./supplier-create-button";
import { DownloadCsvButton } from "@/components/shared/download-csv-button";
import { resolveViewPreference } from "@/lib/view-preference";
import { ViewOptionsBar } from "@/components/shared/view-options-bar";
import { GroupSection } from "@/components/shared/group-section";
import { groupRows } from "@/lib/group-rows";
import type { Supplier } from "@prisma/client";

/**
 * Render a free-form category string in human-readable form.
 * Categories arrive as snake_case ("cleaning_services") or
 * SCREAMING_SNAKE ("OFFICE_SUPPLIES") from the create form. Convert
 * to "Cleaning Services" / "Office Supplies" without losing
 * obviously-acronymish tokens (HR, IT) — those stay uppercase.
 */
const ACRONYM_TOKENS = new Set(["IT", "HR", "QA", "PR", "SEO", "SaaS"]);
function titleCase(s: string): string {
  return s
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => {
      const upper = word.toUpperCase();
      if (ACRONYM_TOKENS.has(upper)) return upper;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

const GROUP_OPTIONS = [
  { value: "location", label: "Location" },
  { value: "category", label: "Category" },
  { value: "status", label: "Status" },
] as const;
type GroupKey = (typeof GROUP_OPTIONS)[number]["value"];

function groupKeyOf(supplier: Supplier, groupBy: GroupKey): string | null {
  switch (groupBy) {
    case "location":
      return supplier.location;
    case "category":
      return titleCase(supplier.category);
    case "status":
      return titleCase(supplier.status);
  }
}

export const metadata = { title: "Suppliers · OpsHub" };

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: { view?: string; groupBy?: string };
}) {
  const user = await requireAuth();

  const perms = await resolveModulePerms(user.id, user.role, "suppliers");
  if (!perms.canView) return <AccessDenied module="suppliers" moduleLabel="Suppliers" moduleDescription="Vendor and supplier management" />;

  const view = resolveViewPreference(searchParams.view, "suppliers", ["table", "cards"], "table");
  const groupBy = GROUP_OPTIONS.some((o) => o.value === searchParams.groupBy)
    ? (searchParams.groupBy as GroupKey)
    : null;

  const suppliers = await db.supplier.findMany({
    where: { deletedAt: null },
    orderBy: [{ isPreferred: "desc" }, { name: "asc" }],
  });
  const categories = Array.from(new Set(suppliers.map((s) => s.category))).sort();

  const groups = groupBy
    ? groupRows(suppliers, (s) => groupKeyOf(s, groupBy))
    : [{ label: "", rows: suppliers }];

  const renderCards = (rows: Supplier[]) => (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((supplier) => (
        <Link key={supplier.id} href={`/suppliers/${supplier.id}`}>
          <Card className="hover:shadow-md transition-shadow h-full">
            <CardContent className="p-5">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-foreground">{supplier.name}</h3>
                  {supplier.isPreferred && (
                    <Star className="h-4 w-4 text-warning fill-warning" />
                  )}
                </div>
                <StatusBadge status={supplier.status} />
              </div>
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <Badge variant="outline">{titleCase(supplier.category)}</Badge>
                {supplier.location && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3" />
                    {supplier.location}
                  </span>
                )}
              </div>
              <div className="space-y-1 text-xs text-muted-foreground">
                {supplier.contactName && <p>{supplier.contactName}</p>}
                {supplier.contactEmail && (
                  <p className="flex items-center gap-1"><Mail className="h-3 w-3" />{supplier.contactEmail}</p>
                )}
                {supplier.contactPhone && (
                  <p className="flex items-center gap-1"><Phone className="h-3 w-3" />{supplier.contactPhone}</p>
                )}
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );

  const renderTable = (rows: Supplier[]) => (
    <Card>
      <CardContent className="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="p-3 font-medium">Name</th>
              <th className="p-3 font-medium">Category</th>
              <th className="p-3 font-medium">Location</th>
              <th className="p-3 font-medium">Contact</th>
              <th className="p-3 font-medium">Email</th>
              <th className="p-3 font-medium">Phone</th>
              <th className="p-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((supplier) => (
              <tr key={supplier.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                <td className="p-3">
                  <Link
                    href={`/suppliers/${supplier.id}`}
                    className="font-medium hover:text-primary hover:underline inline-flex items-center gap-1.5"
                  >
                    {supplier.name}
                    {supplier.isPreferred && (
                      <Star className="h-3.5 w-3.5 text-warning fill-warning" />
                    )}
                  </Link>
                </td>
                <td className="p-3 text-muted-foreground">{titleCase(supplier.category)}</td>
                <td className="p-3 text-muted-foreground">{supplier.location || "—"}</td>
                <td className="p-3 text-muted-foreground">{supplier.contactName || "—"}</td>
                <td className="p-3 text-muted-foreground">{supplier.contactEmail || "—"}</td>
                <td className="p-3 text-muted-foreground">{supplier.contactPhone || "—"}</td>
                <td className="p-3"><StatusBadge status={supplier.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );

  const renderRows = view === "table" ? renderTable : renderCards;

  return (
    <div>
      <PageHeader
        title="Suppliers"
        description="Manage vendors and service providers"
        actions={
          <div className="flex items-center gap-2">
            {user.role === "ADMIN" && <DownloadCsvButton importerKey="suppliers" />}
            {perms.canCreate && <SupplierCreateButton categories={categories} />}
          </div>
        }
      />

      <ViewOptionsBar
        view={view}
        viewOptions={[
          { value: "table", label: "Table" },
          { value: "cards", label: "Cards" },
        ]}
        storageKey="suppliers"
        groupBy={groupBy}
        groupByOptions={[...GROUP_OPTIONS]}
      />

      {suppliers.length === 0 ? (
        <EmptyState icon={Truck} title="No suppliers yet" description="Add your first supplier" />
      ) : groupBy ? (
        groups.map((group) => (
          <GroupSection key={group.label} label={group.label} count={group.rows.length}>
            {renderRows(group.rows)}
          </GroupSection>
        ))
      ) : (
        renderRows(suppliers)
      )}
    </div>
  );
}
