import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { CommentSection } from "@/components/shared/comment-section";
import { Badge } from "@/components/ui/badge";
import { Star, Mail, Phone, MapPin, Globe, AlertTriangle, CheckCircle2, FileBadge } from "lucide-react";
import Link from "next/link";
import { format } from "date-fns";
import { SubcontractorActions } from "./subcontractor-actions";
import { SubcontractorContacts } from "./subcontractor-contacts";
import { SubcontractorProjects } from "./subcontractor-projects";
import { SubcontractorAttachments } from "./subcontractor-attachments";
import { Avatar } from "@/components/ui/avatar";

interface Props {
  params: Promise<{ subcontractorId: string }>;
}

const formatCurrency = (n: number, currency = "USD") =>
  n.toLocaleString("en-US", { style: "currency", currency, minimumFractionDigits: 2 });

export default async function SubcontractorDetailPage({ params }: Props) {
  const { subcontractorId } = await params;
  const user = await requireAuth();

  const perms = await resolveModulePerms(user.id, user.role, "subcontractors");
  if (!perms.canView) {
    return (
      <AccessDenied
        module="subcontractors"
        moduleLabel="Subcontractors"
        moduleDescription="External project labor — 1099 contractors, sub firms, and staffing agencies"
      />
    );
  }

  const sub = await db.subcontractor.findFirst({
    where: { id: subcontractorId, deletedAt: null },
    include: {
      accountManager: { select: { id: true, name: true } },
      contacts: { orderBy: [{ isPrimary: "desc" }, { name: "asc" }] },
      projects: {
        where: { project: { deletedAt: null } },
        include: {
          project: { select: { id: true, name: true, status: true, client: { select: { id: true, name: true } } } },
        },
        orderBy: { createdAt: "desc" },
      },
      links: true,
      comments: {
        include: { author: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!sub) notFound();

  // Edit-dialog dropdowns — read-only viewers don't need the org-wide
  // project / user name lists (linked project names come from the
  // included relations above).
  const [allProjects, allUsers] = perms.canEdit
    ? await Promise.all([
        db.project.findMany({
          where: { deletedAt: null },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        }),
        db.user.findMany({
          where: { isActive: true },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        }),
      ])
    : [[], []];

  const now = new Date();
  const totalActiveValue = sub.projects
    .filter((p) => p.status === "ACTIVE" || p.status === "PLANNED")
    .reduce((acc, p) => acc + (p.contractValue || 0), 0);
  const insuranceLapsed = sub.insuranceExpiresAt && sub.insuranceExpiresAt < now;
  const insuranceExpiringSoon =
    sub.insuranceExpiresAt &&
    !insuranceLapsed &&
    sub.insuranceExpiresAt.getTime() - now.getTime() < 30 * 24 * 60 * 60 * 1000;

  return (
    <div>
      <PageHeader
        title={sub.name}
        actions={
          <SubcontractorActions
            subcontractor={sub}
            users={allUsers}
            canEdit={perms.canEdit}
            canDelete={perms.canDelete}
          />
        }
      />

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <StatusBadge status={sub.status} />
        <Badge variant="outline">{sub.type}</Badge>
        {sub.isPreferred && (
          <Badge variant="warning" className="flex items-center gap-1">
            <Star className="h-3 w-3" /> Preferred
          </Badge>
        )}
        {sub.complianceStatus !== "COMPLIANT" && (
          <Badge
            variant={sub.complianceStatus === "NON_COMPLIANT" || sub.complianceStatus === "EXPIRED" ? "destructive" : "warning"}
          >
            {sub.complianceStatus.replace("_", " ").toLowerCase()}
          </Badge>
        )}
        {(insuranceLapsed || insuranceExpiringSoon) && (
          <Badge variant={insuranceLapsed ? "destructive" : "warning"} className="flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            Insurance {insuranceLapsed ? "expired" : "expiring"}
          </Badge>
        )}
        {sub.rating != null && (
          <Badge variant="outline" className="flex items-center gap-1">
            <Star className="h-3 w-3" /> {sub.rating.toFixed(1)}
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          {sub.summary && (
            <Card>
              <CardHeader>
                <CardTitle>Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{sub.summary}</p>
              </CardContent>
            </Card>
          )}

          {sub.specialties.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Specialties</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {sub.specialties.map((s) => (
                    <Badge key={s} variant="outline">{s}</Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>
                Projects ({sub.projects.length})
                {totalActiveValue > 0 && (
                  <span className="ml-3 text-sm font-normal text-muted-foreground">
                    {formatCurrency(totalActiveValue, sub.currency || "USD")} active value
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <SubcontractorProjects
                subcontractorId={sub.id}
                links={sub.projects.map((p) => ({
                  id: p.id,
                  projectId: p.projectId,
                  projectName: p.project?.name || "",
                  projectStatus: p.project?.status || null,
                  clientName: p.project?.client?.name || null,
                  clientId: p.project?.client?.id || null,
                  scope: p.scope,
                  role: p.role,
                  status: p.status,
                  startDate: p.startDate,
                  endDate: p.endDate,
                  contractValue: p.contractValue,
                  currency: p.currency,
                  rate: p.rate,
                  rateUnit: p.rateUnit,
                  notes: p.notes,
                }))}
                allProjects={allProjects}
                canEdit={perms.canEdit}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Contacts</CardTitle>
            </CardHeader>
            <CardContent>
              <SubcontractorContacts
                contacts={sub.contacts}
                subcontractorId={sub.id}
                canEdit={perms.canEdit}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Comments</CardTitle>
            </CardHeader>
            <CardContent>
              <CommentSection
                comments={sub.comments}
                entityType="subcontractor"
                entityId={sub.id}
                canComment={perms.canComment}
                canDelete={perms.canDelete}
                currentUserId={user.id}
              />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Account Manager</CardTitle>
            </CardHeader>
            <CardContent>
              {sub.accountManager ? (
                <Link
                  href={`/team/${sub.accountManager.id}`}
                  className="flex items-center gap-3 hover:text-primary"
                >
                  <Avatar name={sub.accountManager.name || "?"} size="sm" />
                  <span className="text-sm font-medium hover:underline">{sub.accountManager.name}</span>
                </Link>
              ) : (
                <p className="text-sm text-muted-foreground">Not assigned</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Primary Contact</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 text-sm">
                {sub.primaryContactName && <p className="font-medium">{sub.primaryContactName}</p>}
                {sub.primaryContactEmail && (
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <Mail className="h-4 w-4" /> {sub.primaryContactEmail}
                  </p>
                )}
                {sub.primaryContactPhone && (
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <Phone className="h-4 w-4" /> {sub.primaryContactPhone}
                  </p>
                )}
                {sub.address && (
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <MapPin className="h-4 w-4 shrink-0" /> {sub.address}
                  </p>
                )}
                {sub.website && (
                  <a
                    href={sub.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-primary hover:underline"
                  >
                    <Globe className="h-4 w-4" /> {sub.website}
                  </a>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Compliance</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                <ComplianceRow
                  label="W-9 on file"
                  ok={sub.w9OnFile}
                />
                <ComplianceRow
                  label="MSA signed"
                  ok={!!sub.msaSignedAt}
                  detail={sub.msaSignedAt ? format(sub.msaSignedAt, "MMM d, yyyy") : undefined}
                />
                <ComplianceRow
                  label="NDA signed"
                  ok={!!sub.ndaSignedAt}
                  detail={sub.ndaSignedAt ? format(sub.ndaSignedAt, "MMM d, yyyy") : undefined}
                />
                <ComplianceRow
                  label="Insurance"
                  ok={!!sub.insuranceExpiresAt && !insuranceLapsed && !insuranceExpiringSoon}
                  warn={!!insuranceExpiringSoon}
                  fail={!!insuranceLapsed}
                  detail={sub.insuranceExpiresAt ? `Exp. ${format(sub.insuranceExpiresAt, "MMM d, yyyy")}` : "No expiry on file"}
                />
                {sub.complianceNotes && (
                  <p className="pt-2 text-xs text-muted-foreground whitespace-pre-wrap">{sub.complianceNotes}</p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Financial</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                {sub.defaultRate != null ? (
                  <p>
                    <span className="text-muted-foreground">Default rate:</span>{" "}
                    <span className="font-medium">
                      {formatCurrency(sub.defaultRate, sub.currency || "USD")}
                      {sub.rateUnit ? ` / ${sub.rateUnit}` : ""}
                    </span>
                  </p>
                ) : (
                  <p className="text-muted-foreground">No default rate set</p>
                )}
                {sub.paymentTerms && (
                  <p>
                    <span className="text-muted-foreground">Payment terms:</span>{" "}
                    <span className="font-medium">{sub.paymentTerms}</span>
                  </p>
                )}
                {sub.taxId && (
                  <p>
                    <span className="text-muted-foreground">Tax ID:</span>{" "}
                    <span className="font-medium">{sub.taxId}</span>
                  </p>
                )}
                {sub.businessLicense && (
                  <p>
                    <span className="text-muted-foreground">Business license:</span>{" "}
                    <span className="font-medium">{sub.businessLicense}</span>
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileBadge className="h-4 w-4" /> Attachments
              </CardTitle>
            </CardHeader>
            <CardContent>
              <SubcontractorAttachments
                subcontractorId={sub.id}
                links={sub.links}
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

function ComplianceRow({
  label,
  ok,
  warn,
  fail,
  detail,
}: {
  label: string;
  ok?: boolean;
  warn?: boolean;
  fail?: boolean;
  detail?: string;
}) {
  const Icon = fail ? AlertTriangle : warn ? AlertTriangle : ok ? CheckCircle2 : AlertTriangle;
  const color = fail
    ? "text-destructive"
    : warn
      ? "text-warning"
      : ok
        ? "text-success"
        : "text-muted-foreground";
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${color}`} />
        <span>{label}</span>
      </span>
      {detail && <span className="text-xs text-muted-foreground">{detail}</span>}
    </div>
  );
}
