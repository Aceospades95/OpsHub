import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Globe, ArrowLeft, ExternalLink as ExternalLinkIcon } from "lucide-react";
import Link from "next/link";
import { formatCalendarDate } from "@/lib/dates";
import { PortalCreateButton, PortalRowActions } from "./portal-manager";

export const metadata = { title: "Bid Portals · OpsHub" };

/**
 * Registry of the procurement / bidding portals we're registered on —
 * the places deals come from. Lives inside the bids module (not
 * intranet resources) because portals are structured pipeline data:
 * every opportunity records which portal produced it, so win rates and
 * "is this registration worth renewing" fall out of the pipeline.
 */
export default async function BidPortalsPage() {
  const user = await requireAuth();

  const perms = await resolveModulePerms(user.id, user.role, "bids");
  if (!perms.canView) {
    return (
      <AccessDenied
        module="bids"
        moduleLabel="Bid Pipeline"
        moduleDescription="Procurement portals, open bids, and win/loss history"
      />
    );
  }

  const portals = await db.bidPortal.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    include: { _count: { select: { bids: true } } },
  });

  const now = new Date();

  return (
    <div>
      <PageHeader
        title="Bid Portals"
        description="Procurement sites we're registered on — where the pipeline gets fed"
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/bids"
              className="inline-flex h-9 items-center gap-1 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-muted"
            >
              <ArrowLeft className="h-4 w-4" /> Pipeline
            </Link>
            {perms.canCreate && <PortalCreateButton />}
          </div>
        }
      />

      {portals.length === 0 ? (
        <EmptyState
          icon={Globe}
          title="No portals registered yet"
          description="Add the procurement sites you're registered on — SAM.gov, BidBuy, city/county portals — so every bid can point back to its source."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Portal</th>
                <th className="px-3 py-2 font-medium">Jurisdiction</th>
                <th className="px-3 py-2 font-medium">Account</th>
                <th className="px-3 py-2 font-medium">Registration renews</th>
                <th className="px-3 py-2 font-medium text-right">Bids</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {portals.map((portal) => {
                const renewalPast =
                  portal.registrationRenewsAt && portal.registrationRenewsAt.getTime() < now.getTime();
                return (
                  <tr key={portal.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5 font-medium">
                        {portal.name}
                        {portal.url && (
                          <a
                            href={portal.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`Open ${portal.name}`}
                            className="text-muted-foreground hover:text-primary"
                          >
                            <ExternalLinkIcon className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                      {portal.notes && (
                        <p className="text-xs text-muted-foreground line-clamp-1">{portal.notes}</p>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">{portal.jurisdiction || "—"}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{portal.accountIdentifier || "—"}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {portal.registrationRenewsAt ? (
                        <span className={renewalPast ? "text-destructive font-medium" : "text-muted-foreground"}>
                          {formatCalendarDate(portal.registrationRenewsAt, "MMM d, yyyy")}
                          {renewalPast && " — lapsed?"}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      <Link href="/bids?view=table" className="hover:text-primary hover:underline">
                        {portal._count.bids}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge variant={portal.isActive ? "success" : "secondary"}>
                        {portal.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5">
                      <PortalRowActions
                        portal={{
                          id: portal.id,
                          name: portal.name,
                          url: portal.url,
                          jurisdiction: portal.jurisdiction,
                          accountIdentifier: portal.accountIdentifier,
                          registrationRenewsAt: portal.registrationRenewsAt
                            ? portal.registrationRenewsAt.toISOString()
                            : null,
                          isActive: portal.isActive,
                          notes: portal.notes,
                          bidCount: portal._count.bids,
                        }}
                        canEdit={perms.canEdit}
                        canDelete={perms.canDelete}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
