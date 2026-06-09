import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { CommentSection } from "@/components/shared/comment-section";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Mail, Phone, MapPin, Globe, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { formatCalendarDate } from "@/lib/dates";
import { PartnershipActions } from "./partnership-actions";
import { PartnershipContacts } from "./partnership-contacts";
import { PartnershipProjects } from "./partnership-projects";
import { PartnershipAttachments } from "./partnership-attachments";

interface Props {
  params: Promise<{ partnershipId: string }>;
}

const TIER_VARIANTS: Record<string, "outline" | "warning" | "success" | "secondary" | "default"> = {
  PLATINUM: "default",
  GOLD: "warning",
  SILVER: "secondary",
  BRONZE: "outline",
  STANDARD: "outline",
};

const fmtCurrency = (n: number, currency = "USD") =>
  n.toLocaleString("en-US", { style: "currency", currency, minimumFractionDigits: 0 });

export default async function PartnershipDetailPage({ params }: Props) {
  const { partnershipId } = await params;
  const user = await requireAuth();

  const perms = await resolveModulePerms(user.id, user.role, "partnerships");
  if (!perms.canView) {
    return (
      <AccessDenied
        module="partnerships"
        moduleLabel="Partnerships"
        moduleDescription="Strategic relationships — referrers, resellers, technology, channel, and joint-venture partners"
      />
    );
  }

  const partnership = await db.partnership.findFirst({
    where: { id: partnershipId, deletedAt: null },
    include: {
      relationshipOwner: { select: { id: true, name: true } },
      contacts: { orderBy: [{ isPrimary: "desc" }, { name: "asc" }] },
      projects: {
        where: { project: { deletedAt: null } },
        include: {
          project: {
            select: {
              id: true,
              name: true,
              status: true,
              client: { select: { id: true, name: true } },
            },
          },
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

  if (!partnership) notFound();

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
  const referralProjects = partnership.projects.filter((pp) => pp.role === "REFERRER");
  const totalReferralValue = referralProjects.reduce((acc, p) => acc + (p.referralValue || 0), 0);
  const agreementExpired = partnership.agreementExpiresAt && partnership.agreementExpiresAt < now;
  const agreementLapsing =
    !agreementExpired &&
    partnership.agreementExpiresAt &&
    partnership.agreementExpiresAt.getTime() - now.getTime() < 60 * 24 * 60 * 60 * 1000;
  const referralFeePercent =
    partnership.referralFeeBps != null ? (partnership.referralFeeBps / 100).toFixed(2) : null;

  return (
    <div>
      <PageHeader
        title={partnership.name}
        description={partnership.description || undefined}
        actions={
          <PartnershipActions
            partnership={partnership}
            users={allUsers}
            canEdit={perms.canEdit}
            canDelete={perms.canDelete}
          />
        }
      />

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <StatusBadge status={partnership.status} />
        <Badge variant="outline">{partnership.type.replace("_", " ").toLowerCase()}</Badge>
        {partnership.tier && (
          <Badge variant={TIER_VARIANTS[partnership.tier] || "outline"}>{partnership.tier}</Badge>
        )}
        {partnership.industry && <Badge variant="outline">{partnership.industry}</Badge>}
        {agreementExpired && (
          <Badge variant="destructive" className="flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" /> Agreement expired
          </Badge>
        )}
        {agreementLapsing && (
          <Badge variant="warning" className="flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" /> Renewal due
          </Badge>
        )}
        {partnership.jointMarketing && <Badge variant="success">Joint marketing</Badge>}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          {partnership.summary && (
            <Card>
              <CardHeader>
                <CardTitle>Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{partnership.summary}</p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>
                Projects ({partnership.projects.length})
                {totalReferralValue > 0 && (
                  <span className="ml-3 text-sm font-normal text-muted-foreground">
                    {fmtCurrency(totalReferralValue)} referral value
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <PartnershipProjects
                partnershipId={partnership.id}
                links={partnership.projects.map((p) => ({
                  id: p.id,
                  projectId: p.projectId,
                  projectName: p.project?.name || "",
                  projectStatus: p.project?.status || null,
                  clientName: p.project?.client?.name || null,
                  clientId: p.project?.client?.id || null,
                  role: p.role,
                  notes: p.notes,
                  referralValue: p.referralValue,
                  currency: p.currency,
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
              <PartnershipContacts
                contacts={partnership.contacts}
                partnershipId={partnership.id}
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
                comments={partnership.comments}
                entityType="partnership"
                entityId={partnership.id}
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
              <CardTitle>Relationship Owner</CardTitle>
            </CardHeader>
            <CardContent>
              {partnership.relationshipOwner ? (
                <Link
                  href={`/team/${partnership.relationshipOwner.id}`}
                  className="flex items-center gap-3 hover:text-primary"
                >
                  <Avatar name={partnership.relationshipOwner.name || "?"} size="sm" />
                  <span className="text-sm font-medium hover:underline">{partnership.relationshipOwner.name}</span>
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
                {partnership.primaryContactName && <p className="font-medium">{partnership.primaryContactName}</p>}
                {partnership.primaryContactEmail && (
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <Mail className="h-4 w-4" /> {partnership.primaryContactEmail}
                  </p>
                )}
                {partnership.primaryContactPhone && (
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <Phone className="h-4 w-4" /> {partnership.primaryContactPhone}
                  </p>
                )}
                {partnership.address && (
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <MapPin className="h-4 w-4 shrink-0" /> {partnership.address}
                  </p>
                )}
                {partnership.website && (
                  <a
                    href={partnership.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-primary hover:underline"
                  >
                    <Globe className="h-4 w-4" /> {partnership.website}
                  </a>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Agreement</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                {partnership.partnerSinceDate && (
                  <p>
                    <span className="text-muted-foreground">Partner since:</span>{" "}
                    <span className="font-medium">{formatCalendarDate(partnership.partnerSinceDate, "MMM d, yyyy")}</span>
                  </p>
                )}
                {partnership.agreementSignedAt && (
                  <p>
                    <span className="text-muted-foreground">Signed:</span>{" "}
                    <span className="font-medium">{formatCalendarDate(partnership.agreementSignedAt, "MMM d, yyyy")}</span>
                  </p>
                )}
                {partnership.agreementExpiresAt && (
                  <p>
                    <span className="text-muted-foreground">Expires:</span>{" "}
                    <span className={`font-medium ${agreementExpired ? "text-destructive" : agreementLapsing ? "text-warning" : ""}`}>
                      {formatCalendarDate(partnership.agreementExpiresAt, "MMM d, yyyy")}
                    </span>
                  </p>
                )}
                <p>
                  <span className="text-muted-foreground">Auto-renew:</span>{" "}
                  <span className="font-medium">{partnership.autoRenew ? "Yes" : "No"}</span>
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Commercial</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                {referralFeePercent && (
                  <p>
                    <span className="text-muted-foreground">Referral fee:</span>{" "}
                    <span className="font-medium">{referralFeePercent}%</span>
                  </p>
                )}
                {partnership.revenueShareTerms && (
                  <p className="whitespace-pre-wrap text-muted-foreground">{partnership.revenueShareTerms}</p>
                )}
                {!referralFeePercent && !partnership.revenueShareTerms && (
                  <p className="text-muted-foreground">No commercial terms recorded</p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Attachments</CardTitle>
            </CardHeader>
            <CardContent>
              <PartnershipAttachments
                partnershipId={partnership.id}
                links={partnership.links}
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
