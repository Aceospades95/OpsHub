import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { CommentSection } from "@/components/shared/comment-section";
import { Badge } from "@/components/ui/badge";
import { Star, Mail, Phone, MapPin, Globe } from "lucide-react";
import { SupplierActions } from "./supplier-actions";
import { SupplierProjects } from "./supplier-projects";
import { SupplierAttachments } from "./supplier-attachments";

interface Props {
  params: Promise<{ supplierId: string }>;
}

export default async function SupplierDetailPage({ params }: Props) {
  const { supplierId } = await params;
  const user = await requireAuth();

  const perms = await resolveModulePerms(user.id, user.role, "suppliers");
  if (!perms.canView) return <AccessDenied module="suppliers" moduleLabel="Suppliers" moduleDescription="Vendor and supplier management" />;

  const supplier = await db.supplier.findFirst({
    where: { id: supplierId, deletedAt: null },
    include: {
      projects: true,
      links: true,
      comments: {
        include: { author: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!supplier) notFound();

  const allProjects = await db.project.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <div>
      <PageHeader
        title={supplier.name}
        actions={
          <SupplierActions supplier={supplier} canEdit={perms.canEdit} canDelete={perms.canDelete} />
        }
      />

      <div className="flex items-center gap-3 mb-6">
        <StatusBadge status={supplier.status} />
        <Badge variant="outline">{supplier.category}</Badge>
        {supplier.isPreferred && (
          <Badge variant="warning" className="flex items-center gap-1">
            <Star className="h-3 w-3" /> Preferred
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          {supplier.notes && (
            <Card>
              <CardHeader><CardTitle>Notes</CardTitle></CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{supplier.notes}</p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle>Linked Projects</CardTitle></CardHeader>
            <CardContent>
              <SupplierProjects
                supplierProjects={supplier.projects}
                supplierId={supplier.id}
                allProjects={allProjects}
                canEdit={perms.canEdit}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Comments</CardTitle></CardHeader>
            <CardContent>
              <CommentSection
                comments={supplier.comments}
                entityType="supplier"
                entityId={supplier.id}
                canComment={perms.canComment}
                canDelete={perms.canDelete}
                currentUserId={user.id}
              />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Contact Information</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3 text-sm">
                {supplier.contactName && <p className="font-medium">{supplier.contactName}</p>}
                {supplier.contactEmail && (
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <Mail className="h-4 w-4" /> {supplier.contactEmail}
                  </p>
                )}
                {supplier.contactPhone && (
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <Phone className="h-4 w-4" /> {supplier.contactPhone}
                  </p>
                )}
                {supplier.address && (
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <MapPin className="h-4 w-4 shrink-0" /> {supplier.address}
                  </p>
                )}
                {supplier.website && (
                  <a href={supplier.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-primary hover:underline">
                    <Globe className="h-4 w-4" /> {supplier.website}
                  </a>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Attachments</CardTitle></CardHeader>
            <CardContent>
              <SupplierAttachments
                supplierId={supplier.id}
                links={supplier.links}
                canEdit={perms.canEdit}
                canDelete={perms.canDelete}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
