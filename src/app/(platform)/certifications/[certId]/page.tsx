import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/permissions";
import { getUserScope, canViewEntity, hasOrgWideManage } from "@/lib/scope";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { CommentSection } from "@/components/shared/comment-section";
import { Badge } from "@/components/ui/badge";
import {
  Award,
  Calendar,
  DollarSign,
  User,
  Building2,
  FileText,
  AlertTriangle,
  Clock,
  ExternalLink,
  Globe,
  Mail,
  Phone,
  MapPin,
  CheckCircle2,
  History,
} from "lucide-react";
import { format, differenceInDays } from "date-fns";
import { formatCalendarDate } from "@/lib/dates";
import Link from "next/link";
import { PageLayout } from "@/components/shared/page-layout";
import { CertActions } from "./cert-actions";
import { SignOffCard } from "./sign-off-card";
import { ChecklistCard } from "./checklist-card";
import { AuditTrailCard } from "./audit-trail-card";

interface Props {
  params: Promise<{ certId: string }>;
}

export default async function CertificationDetailPage({ params }: Props) {
  const { certId } = await params;
  const user = await requireAuth();

  if (!hasOrgWideManage(user.role)) {
    return <AccessDenied module="certifications" moduleLabel="Certifications" moduleDescription="Compliance certifications and expirations (Admin / Developer only)" />;
  }

  const cert = await db.certification.findFirst({
    where: { id: certId, deletedAt: null },
    include: {
      client: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true } },
      pointOfContact: { select: { id: true, name: true } },
      signedOffBy: { select: { id: true, name: true } },
      comments: {
        include: { author: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
      },
      links: true,
      embeds: true,
      checklistItems: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        include: { completedBy: { select: { id: true, name: true } } },
      },
      renewalHistory: {
        orderBy: { createdAt: "desc" },
        include: { signedOffBy: { select: { id: true, name: true } } },
      },
    },
  });

  if (!cert) notFound();

  const scope = await getUserScope(user.id, user.role);
  if (!canViewEntity(scope, "certification", cert.id)) {
    return <AccessDenied module="certifications" moduleLabel="Certifications" entityType="certification" entityId={cert.id} entityLabel={cert.name} />;
  }

  const [clients, users] = await Promise.all([
    db.client.findMany({
      where: { deletedAt: null, ...(scope.all ? {} : { id: { in: Array.from(scope.clientIds) } }) },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const now = new Date();
  const daysUntilExpiry = cert.expirationDate ? differenceInDays(cert.expirationDate, now) : null;
  const isExpiring =
    daysUntilExpiry !== null &&
    daysUntilExpiry > 0 &&
    daysUntilExpiry <= (cert.renewalLeadDays || 90);
  const isExpired = daysUntilExpiry !== null && daysUntilExpiry <= 0;

  const role = user.role;
  const canEdit = role === "ADMIN" || role === "MANAGER" || role === "DEVELOPER";
  const canSignOff = role === "ADMIN" || role === "MANAGER";
  const canRevoke = role === "ADMIN";
  const canEditLayout = role === "ADMIN" || role === "DEVELOPER";

  // Contributors can toggle checklist only if they're the assignee or POC
  const canModifyChecklist =
    canEdit ||
    cert.assigneeId === user.id ||
    cert.pointOfContactId === user.id;

  const jurisdictionLabel = [cert.jurisdictionLevel, cert.jurisdictionName]
    .filter(Boolean)
    .join(" · ");

  const cardMap: Record<string, React.ReactNode> = {
    overview: (
      <Card className="h-full">
        <CardHeader>
          <CardTitle>Overview</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {cert.plainEnglishSummary && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                What is this?
              </p>
              <p className="text-sm whitespace-pre-wrap">{cert.plainEnglishSummary}</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Status</span>
              <div className="mt-1">
                <StatusBadge status={cert.status} />
              </div>
            </div>
            <div>
              <span className="text-muted-foreground">Category</span>
              <div className="mt-1">
                <Badge variant="outline">{cert.type.replace(/_/g, " ")}</Badge>
              </div>
            </div>
            <div>
              <span className="text-muted-foreground">Engagement</span>
              <div className="mt-1">
                <Badge variant="secondary">
                  {cert.engagementType === "SUBSCRIPTION" ? "Subscription" : "Certification"}
                </Badge>
              </div>
            </div>
            <div>
              <span className="text-muted-foreground flex items-center gap-1">
                <MapPin className="h-3 w-3" /> Jurisdiction
              </span>
              <p className="font-medium mt-1">{jurisdictionLabel || "—"}</p>
            </div>
            {cert.issuingBody && (
              <div>
                <span className="text-muted-foreground">Issuing Body</span>
                <p className="font-medium mt-1">{cert.issuingBody}</p>
              </div>
            )}
            {cert.certNumber && (
              <div>
                <span className="text-muted-foreground">Certificate Number</span>
                <p className="font-medium mt-1">#{cert.certNumber}</p>
              </div>
            )}
            {cert.agencyWebsiteUrl && (
              <div className="col-span-2">
                <span className="text-muted-foreground flex items-center gap-1">
                  <Globe className="h-3 w-3" /> Agency Website
                </span>
                <a
                  href={cert.agencyWebsiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline text-sm mt-1 block truncate"
                >
                  {cert.agencyWebsiteUrl}
                </a>
              </div>
            )}
            {cert.client && (
              <div className="col-span-2">
                <span className="text-muted-foreground flex items-center gap-1">
                  <Building2 className="h-3 w-3" /> Client
                </span>
                <Link
                  href={`/clients/${cert.client.id}`}
                  className="font-medium mt-1 text-primary hover:underline block"
                >
                  {cert.client.name}
                </Link>
              </div>
            )}
          </div>
          {cert.description && (
            <div className="pt-3 border-t border-border">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Detailed Description
              </p>
              <p className="text-sm whitespace-pre-wrap">{cert.description}</p>
            </div>
          )}
        </CardContent>
      </Card>
    ),

    people: (
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-4 w-4" />
            People
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Point of Contact
            </p>
            {cert.pointOfContact ? (
              <Link
                href={`/team/${cert.pointOfContact.id}`}
                className="font-medium text-primary hover:underline"
              >
                {cert.pointOfContact.name}
              </Link>
            ) : (
              <p className="text-muted-foreground italic">Not assigned</p>
            )}
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Assignee
            </p>
            {cert.assignee ? (
              <Link
                href={`/team/${cert.assignee.id}`}
                className="font-medium text-primary hover:underline"
              >
                {cert.assignee.name}
              </Link>
            ) : (
              <p className="text-muted-foreground italic">Not assigned</p>
            )}
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Signed Off By
            </p>
            {cert.signedOffBy && cert.signedOffAt ? (
              <div>
                <Link
                  href={`/team/${cert.signedOffBy.id}`}
                  className="font-medium text-primary hover:underline"
                >
                  {cert.signedOffBy.name}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {format(cert.signedOffAt, "MMM d, yyyy · h:mm a")}
                </p>
              </div>
            ) : (
              <p className="text-muted-foreground italic">Not signed off yet</p>
            )}
          </div>
        </CardContent>
      </Card>
    ),

    dates: (
      <Card className={`h-full ${isExpiring ? "border-warning/30" : isExpired ? "border-destructive/30" : ""}`}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Dates & Reminders
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-4">
            {cert.submittedDate && (
              <div>
                <span className="text-muted-foreground">Submitted</span>
                <p className="font-medium mt-1">{formatCalendarDate(cert.submittedDate, "MMM d, yyyy")}</p>
              </div>
            )}
            {cert.issuedDate && (
              <div>
                <span className="text-muted-foreground">Issued</span>
                <p className="font-medium mt-1">{formatCalendarDate(cert.issuedDate, "MMM d, yyyy")}</p>
              </div>
            )}
            {cert.expirationDate && (
              <div>
                <span className="text-muted-foreground">Expires</span>
                <p
                  className={`font-medium mt-1 ${
                    isExpired ? "text-destructive" : isExpiring ? "text-warning" : ""
                  }`}
                >
                  {formatCalendarDate(cert.expirationDate, "MMM d, yyyy")}
                  {daysUntilExpiry !== null && (
                    <span className="text-xs ml-1">
                      (
                      {isExpired
                        ? `${Math.abs(daysUntilExpiry)}d overdue`
                        : `${daysUntilExpiry}d left`}
                      )
                    </span>
                  )}
                </p>
              </div>
            )}
            {cert.renewalDate && (
              <div>
                <span className="text-muted-foreground">Renewal starts</span>
                <p className="font-medium mt-1">{formatCalendarDate(cert.renewalDate, "MMM d, yyyy")}</p>
              </div>
            )}
          </div>
          <div className="pt-3 border-t border-border">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Reminder Schedule
            </p>
            <div className="flex flex-wrap gap-1.5">
              {(cert.reminderOffsetsDays?.length
                ? cert.reminderOffsetsDays
                : [cert.renewalLeadDays || 90]
              )
                .slice()
                .sort((a, b) => b - a)
                .map((n) => (
                  <Badge key={n} variant="outline">
                    {n}d before expiry
                  </Badge>
                ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Reminders are sent to the assignee and point of contact. Edit these in the
              form above.
            </p>
          </div>
        </CardContent>
      </Card>
    ),

    renewal: (
      <Card
        className={`h-full ${
          isExpiring ? "border-warning/30" : isExpired ? "border-destructive/30" : ""
        }`}
      >
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {isExpired ? (
              <AlertTriangle className="h-4 w-4 text-destructive" />
            ) : isExpiring ? (
              <Clock className="h-4 w-4 text-warning" />
            ) : (
              <Award className="h-4 w-4" />
            )}
            Renewal Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Auto-Renew</span>
              <p className="font-medium mt-1">{cert.autoRenew ? "Yes" : "No"}</p>
            </div>
            {cert.renewalCost && (
              <div>
                <span className="text-muted-foreground flex items-center gap-1">
                  <DollarSign className="h-3 w-3" /> Cost
                </span>
                <p className="font-medium mt-1">
                  {cert.currency || "USD"} {cert.renewalCost.toLocaleString()}
                </p>
              </div>
            )}
          </div>

          {cert.renewalRequirements && (
            <div className="pt-3 border-t border-border">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Renewal Requirements
              </p>
              <div className="text-sm whitespace-pre-wrap bg-muted rounded-md p-3">
                {cert.renewalRequirements}
              </div>
            </div>
          )}

          {cert.renewalNotes && (
            <div className="pt-3 border-t border-border">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Notes
              </p>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                {cert.renewalNotes}
              </p>
            </div>
          )}

          {!cert.renewalRequirements && !cert.renewalNotes && (
            <p className="text-sm text-muted-foreground">No renewal information added yet.</p>
          )}
        </CardContent>
      </Card>
    ),

    documents: (
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Documents
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Completed Certificate
            </p>
            {cert.completedCertUrl ? (
              <a
                href={cert.completedCertUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-primary hover:underline break-all"
              >
                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                {cert.completedCertUrl}
              </a>
            ) : (
              <p className="text-muted-foreground italic">No issued certificate linked yet.</p>
            )}
          </div>
          <div className="pt-3 border-t border-border">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Compiled Documents & Links
            </p>
            {cert.documentUrl && (
              <a
                href={cert.documentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-primary hover:underline break-all mb-2"
              >
                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                {cert.documentUrl}
              </a>
            )}
            {cert.links.length === 0 && !cert.documentUrl ? (
              <p className="text-muted-foreground italic">No application materials linked yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {cert.links.map((link) => (
                  <li key={link.id}>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-primary hover:underline break-all"
                    >
                      <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                      {link.title}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>
    ),

    checklist: (
      <ChecklistCard
        certId={cert.id}
        items={cert.checklistItems.map((i) => ({
          id: i.id,
          label: i.label,
          required: i.required,
          completed: i.completed,
          completedAt: i.completedAt,
          completedBy: i.completedBy,
          sortOrder: i.sortOrder,
          notes: i.notes,
        }))}
        canModify={canModifyChecklist}
      />
    ),

    agency: (
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            Agency Contact
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {cert.agencyContactName && (
            <div>
              <span className="text-muted-foreground">Contact Name</span>
              <p className="font-medium mt-0.5">{cert.agencyContactName}</p>
            </div>
          )}
          {cert.agencyContactEmail && (
            <div>
              <span className="text-muted-foreground flex items-center gap-1">
                <Mail className="h-3 w-3" /> Email
              </span>
              <a
                href={`mailto:${cert.agencyContactEmail}`}
                className="text-primary hover:underline mt-0.5 block truncate"
              >
                {cert.agencyContactEmail}
              </a>
            </div>
          )}
          {cert.agencyContactPhone && (
            <div>
              <span className="text-muted-foreground flex items-center gap-1">
                <Phone className="h-3 w-3" /> Phone
              </span>
              <a
                href={`tel:${cert.agencyContactPhone}`}
                className="text-primary hover:underline mt-0.5 block"
              >
                {cert.agencyContactPhone}
              </a>
            </div>
          )}
          {cert.agencyWebsiteUrl && (
            <div>
              <span className="text-muted-foreground flex items-center gap-1">
                <Globe className="h-3 w-3" /> Website
              </span>
              <a
                href={cert.agencyWebsiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline mt-0.5 block truncate"
              >
                {cert.agencyWebsiteUrl}
              </a>
            </div>
          )}
          {!cert.agencyContactName &&
            !cert.agencyContactEmail &&
            !cert.agencyContactPhone &&
            !cert.agencyWebsiteUrl && (
              <p className="text-muted-foreground italic">No agency contact info yet.</p>
            )}
        </CardContent>
      </Card>
    ),

    signoff: (
      <SignOffCard
        cert={{
          id: cert.id,
          signedOffAt: cert.signedOffAt,
          signedOffBy: cert.signedOffBy,
          signOffNotes: cert.signOffNotes,
        }}
        canSignOff={canSignOff}
        canRevoke={canRevoke}
      />
    ),

    audit: <AuditTrailCard certId={cert.id} />,

    "renewal-history": (
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-4 w-4" />
            Renewal History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {cert.renewalHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No past cycles recorded yet. A row is added every time this cert is signed
              off.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="pb-2 font-medium text-muted-foreground">Cycle</th>
                    <th className="pb-2 font-medium text-muted-foreground">Signed off</th>
                    <th className="pb-2 font-medium text-muted-foreground">Cost</th>
                    <th className="pb-2 font-medium text-muted-foreground">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {cert.renewalHistory.map((row) => (
                    <tr key={row.id} className="border-b border-border last:border-0">
                      <td className="py-2">
                        {row.cycleStart
                          ? format(row.cycleStart, "MMM d, yyyy")
                          : "—"}
                        {" → "}
                        {row.cycleEnd ? format(row.cycleEnd, "MMM d, yyyy") : "—"}
                      </td>
                      <td className="py-2">
                        {row.signedOffBy && row.signedOffAt ? (
                          <>
                            <Link
                              href={`/team/${row.signedOffBy.id}`}
                              className="text-primary hover:underline"
                            >
                              {row.signedOffBy.name}
                            </Link>
                            <span className="text-muted-foreground text-xs block">
                              {format(row.signedOffAt, "MMM d, yyyy")}
                            </span>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-2">
                        {row.cost
                          ? `${row.currency || "USD"} ${row.cost.toLocaleString()}`
                          : "—"}
                      </td>
                      <td className="py-2 text-muted-foreground max-w-xs truncate">
                        {row.notes || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    ),

    comments: (
      <Card className="h-full">
        <CardHeader>
          <CardTitle>Comments</CardTitle>
        </CardHeader>
        <CardContent>
          <CommentSection
            comments={cert.comments}
            entityType="certification"
            entityId={cert.id}
            canComment={true}
            canDelete={canEdit}
            currentUserId={user.id}
          />
        </CardContent>
      </Card>
    ),
  };

  return (
    <div>
      <PageHeader
        title={cert.name}
        description={cert.issuingBody ? `Issued by ${cert.issuingBody}` : undefined}
        actions={canEdit ? <CertActions cert={cert} clients={clients} users={users} /> : undefined}
      />

      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <StatusBadge status={cert.status} />
        <Badge variant="outline">{cert.type.replace(/_/g, " ")}</Badge>
        <Badge variant="secondary" className="gap-1">
          <MapPin className="h-3 w-3" />
          {jurisdictionLabel || cert.jurisdictionLevel}
        </Badge>
        {cert.engagementType === "SUBSCRIPTION" && <Badge variant="outline">Subscription</Badge>}
        {cert.autoRenew && <Badge variant="secondary">Auto-renew</Badge>}
        {cert.signedOffAt && (
          <Badge variant="success" className="gap-1">
            <CheckCircle2 className="h-3 w-3" />
            Signed off
          </Badge>
        )}
        {isExpired && <Badge variant="destructive">Expired</Badge>}
        {isExpiring && <Badge variant="warning">Expiring Soon</Badge>}
      </div>

      <PageLayout
        pageType="certification-detail"
        cards={cardMap}
        canEdit={canEditLayout}
        mode="flow"
      />
    </div>
  );
}
