import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building, Mail, Phone } from "lucide-react";
import { formatCalendarDate } from "@/lib/dates";
import { resolveLinkTargets, linkTargetKey, isContactEntityType } from "@/lib/contacts";
import { ContactActions } from "./contact-actions";
import { ContactLinksSection } from "./contact-links-section";
import { DepartedToggle } from "./departed-toggle";
import { InteractionsSection } from "./interactions-section";

interface Props {
  params: Promise<{ contactId: string }>;
}

export default async function ContactDetailPage({ params }: Props) {
  const { contactId } = await params;
  const user = await requireAuth();

  // Same cross-module gate as the list page / write actions.
  const perms = await resolveModulePerms(user.id, user.role, "clients");
  if (!perms.canView) {
    return (
      <AccessDenied
        module="clients"
        moduleLabel="Contacts"
        moduleDescription="People across clients, suppliers, subcontractors, partnerships, bids, projects, and contracts"
      />
    );
  }

  const contact = await db.contact.findFirst({
    where: { id: contactId, deletedAt: null },
    include: {
      contactLinks: { orderBy: { createdAt: "asc" } },
      interactions: {
        // Reverse-chronological timeline; same-day entries newest-logged first.
        orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
        include: { createdBy: { select: { name: true } } },
      },
    },
  });
  if (!contact) notFound();

  // Resolve names/hrefs for the polymorphic links; dangling or
  // soft-deleted targets get no map entry and are skipped silently.
  const targets = await resolveLinkTargets(contact.contactLinks);
  const links = contact.contactLinks.flatMap((link) => {
    if (!isContactEntityType(link.entityType)) return [];
    const target = targets.get(linkTargetKey(link.entityType, link.entityId));
    if (!target) return [];
    return [
      {
        id: link.id,
        entityType: link.entityType,
        roles: link.roles,
        isPrimary: link.isPrimary,
        targetName: target.name,
        targetHref: target.href,
      },
    ];
  });

  // Plain serializable rows for the client card; the author name comes
  // along so the timeline can credit who logged each touch.
  const interactions = contact.interactions.map((interaction) => ({
    id: interaction.id,
    kind: interaction.kind,
    occurredAt: interaction.occurredAt.toISOString(),
    summary: interaction.summary,
    notes: interaction.notes,
    createdById: interaction.createdById,
    createdByName: interaction.createdBy?.name ?? null,
  }));

  return (
    <div>
      <PageHeader
        title={contact.name}
        description={[contact.title, contact.organization].filter(Boolean).join(" · ") || undefined}
        actions={
          <ContactActions
            contact={{
              id: contact.id,
              name: contact.name,
              title: contact.title,
              email: contact.email,
              phone: contact.phone,
              organization: contact.organization,
              notes: contact.notes,
              isFormer: contact.isFormer,
            }}
            canEdit={perms.canEdit}
            isAdmin={user.role === "ADMIN"}
          />
        }
      />

      {contact.isFormer && (
        <div className="mb-6 flex items-center gap-3">
          <Badge variant="outline">Departed</Badge>
          <span className="text-sm text-muted-foreground">
            Kept for history — hidden from pickers and copy lists.
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Linked to ({links.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <ContactLinksSection
                contactId={contact.id}
                links={links}
                canEdit={perms.canEdit}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Interactions ({interactions.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <InteractionsSection
                contactId={contact.id}
                interactions={interactions}
                canEdit={perms.canEdit}
                currentUserId={user.id}
                isAdmin={user.role === "ADMIN"}
              />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 text-sm">
                {contact.organization && (
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <Building className="h-4 w-4 shrink-0" /> {contact.organization}
                  </p>
                )}
                {contact.email && (
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <Mail className="h-4 w-4 shrink-0" />{" "}
                    <a
                      href={`mailto:${contact.email}`}
                      className="text-primary hover:underline truncate"
                    >
                      {contact.email}
                    </a>
                  </p>
                )}
                {/* Departed people's notes often say where the mailbox
                    redirects — surface them right under the email. */}
                {contact.isFormer && contact.notes && (
                  <p className="rounded bg-muted p-2 text-xs text-muted-foreground whitespace-pre-wrap">
                    {contact.notes}
                  </p>
                )}
                {contact.phone && (
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <Phone className="h-4 w-4 shrink-0" />{" "}
                    <a href={`tel:${contact.phone}`} className="text-primary hover:underline">
                      {contact.phone}
                    </a>
                  </p>
                )}
                {!contact.organization && !contact.email && !contact.phone && (
                  <p className="text-muted-foreground">No contact details recorded</p>
                )}
                <p className="pt-2 text-xs text-muted-foreground">
                  Added {formatCalendarDate(contact.createdAt, "MMM d, yyyy")}
                </p>
              </div>
              {perms.canEdit && (
                <div className="mt-4 border-t border-border pt-4">
                  <DepartedToggle contactId={contact.id} isFormer={contact.isFormer} />
                </div>
              )}
            </CardContent>
          </Card>

          {contact.notes && (
            <Card>
              <CardHeader>
                <CardTitle>Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{contact.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
