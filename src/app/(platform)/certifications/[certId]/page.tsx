import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { CommentSection } from "@/components/shared/comment-section";
import { Badge } from "@/components/ui/badge";
import { Award, Calendar, DollarSign, User, Building2, FileText, AlertTriangle, Clock, ExternalLink } from "lucide-react";
import { format, differenceInDays } from "date-fns";
import Link from "next/link";
import { PageLayout } from "@/components/shared/page-layout";
import { CertActions } from "./cert-actions";

interface Props {
  params: Promise<{ certId: string }>;
}

export default async function CertificationDetailPage({ params }: Props) {
  const { certId } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");

  const cert = await db.certification.findUnique({
    where: { id: certId },
    include: {
      client: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true } },
      comments: {
        include: { author: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
      },
      links: true,
      embeds: true,
    },
  });

  if (!cert) notFound();

  const [clients, users] = await Promise.all([
    db.client.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.user.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const now = new Date();
  const daysUntilExpiry = cert.expirationDate ? differenceInDays(cert.expirationDate, now) : null;
  const isExpiring = daysUntilExpiry !== null && daysUntilExpiry > 0 && daysUntilExpiry <= (cert.renewalLeadDays || 90);
  const isExpired = daysUntilExpiry !== null && daysUntilExpiry <= 0;

  const canEdit = session.user.role === "ADMIN" || session.user.role === "MANAGER" || session.user.role === "DEVELOPER";
  const canEditLayout = session.user.role === "ADMIN" || session.user.role === "DEVELOPER";

  const cardMap: Record<string, React.ReactNode> = {
    details: (
      <Card className="h-full">
        <CardHeader>
          <CardTitle>Certification Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Status</span>
              <div className="mt-1"><StatusBadge status={cert.status} /></div>
            </div>
            <div>
              <span className="text-muted-foreground">Type</span>
              <div className="mt-1"><Badge variant="outline">{cert.type.replace(/_/g, " ")}</Badge></div>
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
            {cert.issuedDate && (
              <div>
                <span className="text-muted-foreground flex items-center gap-1"><Calendar className="h-3 w-3" /> Issued</span>
                <p className="font-medium mt-1">{format(cert.issuedDate, "MMM d, yyyy")}</p>
              </div>
            )}
            {cert.expirationDate && (
              <div>
                <span className="text-muted-foreground flex items-center gap-1"><Calendar className="h-3 w-3" /> Expires</span>
                <p className={`font-medium mt-1 ${isExpired ? "text-destructive" : isExpiring ? "text-warning" : ""}`}>
                  {format(cert.expirationDate, "MMM d, yyyy")}
                  {daysUntilExpiry !== null && (
                    <span className="text-xs ml-1">
                      ({isExpired ? `${Math.abs(daysUntilExpiry)}d overdue` : `${daysUntilExpiry}d left`})
                    </span>
                  )}
                </p>
              </div>
            )}
            {cert.client && (
              <div>
                <span className="text-muted-foreground flex items-center gap-1"><Building2 className="h-3 w-3" /> Client</span>
                <Link href={`/clients/${cert.client.id}`} className="font-medium mt-1 text-primary hover:underline block">{cert.client.name}</Link>
              </div>
            )}
            {cert.assignee && (
              <div>
                <span className="text-muted-foreground flex items-center gap-1"><User className="h-3 w-3" /> Responsible</span>
                <Link href={`/team/${cert.assignee.id}`} className="font-medium mt-1 block hover:text-primary hover:underline">
                  {cert.assignee.name}
                </Link>
              </div>
            )}
            {cert.documentUrl && (
              <div className="col-span-2">
                <span className="text-muted-foreground flex items-center gap-1"><ExternalLink className="h-3 w-3" /> Document</span>
                <a href={cert.documentUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline text-sm mt-1 block truncate">{cert.documentUrl}</a>
              </div>
            )}
          </div>
          {cert.description && (
            <div className="mt-4 pt-4 border-t border-border">
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{cert.description}</p>
            </div>
          )}
        </CardContent>
      </Card>
    ),

    renewal: (
      <Card className={`h-full ${isExpiring ? "border-warning/30" : isExpired ? "border-destructive/30" : ""}`}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {isExpired ? <AlertTriangle className="h-4 w-4 text-destructive" /> : isExpiring ? <Clock className="h-4 w-4 text-warning" /> : <Award className="h-4 w-4" />}
            Renewal Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            {cert.renewalDate && (
              <div>
                <span className="text-muted-foreground">Renewal Date</span>
                <p className="font-medium mt-1">{format(cert.renewalDate, "MMM d, yyyy")}</p>
              </div>
            )}
            <div>
              <span className="text-muted-foreground">Lead Time</span>
              <p className="font-medium mt-1">{cert.renewalLeadDays || 90} days</p>
            </div>
            <div>
              <span className="text-muted-foreground">Auto-Renew</span>
              <p className="font-medium mt-1">{cert.autoRenew ? "Yes" : "No"}</p>
            </div>
            {cert.renewalCost && (
              <div>
                <span className="text-muted-foreground flex items-center gap-1"><DollarSign className="h-3 w-3" /> Cost</span>
                <p className="font-medium mt-1">{cert.currency || "USD"} {cert.renewalCost.toLocaleString()}</p>
              </div>
            )}
          </div>

          {cert.renewalRequirements && (
            <div className="pt-3 border-t border-border">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Renewal Requirements</p>
              <div className="text-sm whitespace-pre-wrap bg-muted/50 rounded-md p-3">{cert.renewalRequirements}</div>
            </div>
          )}

          {cert.renewalNotes && (
            <div className="pt-3 border-t border-border">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Notes</p>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{cert.renewalNotes}</p>
            </div>
          )}

          {!cert.renewalRequirements && !cert.renewalNotes && !cert.renewalDate && (
            <p className="text-sm text-muted-foreground">No renewal information added yet</p>
          )}
        </CardContent>
      </Card>
    ),

    comments: (
      <Card className="h-full">
        <CardHeader><CardTitle>Comments</CardTitle></CardHeader>
        <CardContent>
          <CommentSection
            comments={cert.comments}
            entityType="certification"
            entityId={cert.id}
            canComment={true}
            canDelete={canEdit}
            currentUserId={session.user.id}
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

      <div className="flex items-center gap-3 mb-6">
        <StatusBadge status={cert.status} />
        <Badge variant="outline">{cert.type.replace(/_/g, " ")}</Badge>
        {cert.autoRenew && <Badge variant="secondary">Auto-renew</Badge>}
        {isExpired && <Badge variant="destructive">Expired</Badge>}
        {isExpiring && <Badge variant="warning">Expiring Soon</Badge>}
      </div>

      <PageLayout pageType="certification-detail" cards={cardMap} canEdit={canEditLayout} />
    </div>
  );
}
