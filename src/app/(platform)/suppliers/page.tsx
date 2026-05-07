import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Truck, Star, Mail, Phone } from "lucide-react";
import Link from "next/link";
import { SupplierCreateButton } from "./supplier-create-button";
import { DownloadCsvButton } from "@/components/shared/download-csv-button";

export default async function SuppliersPage() {
  const user = await requireAuth();

  const perms = await resolveModulePerms(user.id, user.role, "suppliers");
  if (!perms.canView) return <AccessDenied module="suppliers" moduleLabel="Suppliers" moduleDescription="Vendor and supplier management" />;

  const suppliers = await db.supplier.findMany({ where: { deletedAt: null }, orderBy: [{ isPreferred: "desc" }, { name: "asc" }] });

  return (
    <div>
      <PageHeader
        title="Suppliers"
        description="Manage vendors and service providers"
        actions={
          <div className="flex items-center gap-2">
            {user.role === "ADMIN" && <DownloadCsvButton importerKey="suppliers" />}
            {perms.canCreate && <SupplierCreateButton />}
          </div>
        }
      />

      {suppliers.length === 0 ? (
        <EmptyState icon={Truck} title="No suppliers yet" description="Add your first supplier" />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {suppliers.map((supplier) => (
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
                  <Badge variant="outline" className="mb-3">{supplier.category}</Badge>
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
      )}
    </div>
  );
}
