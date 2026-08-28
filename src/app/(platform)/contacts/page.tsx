import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Contact as ContactIcon, Mail, Phone } from "lucide-react";
import Link from "next/link";
import { Prisma } from "@prisma/client";
import { pluralize } from "@/lib/pluralize";
import { formatCalendarDate } from "@/lib/dates";
import {
  CONTACT_ENTITY_TYPES,
  CONTACT_ENTITY_TYPE_LABELS,
  type ContactEntityType,
} from "@/lib/contacts";
import { ContactsFilters } from "./contacts-filters";
import { ContactCreateButton } from "./contact-create-button";

export const metadata = { title: "Contacts · OpsHub" };

interface Props {
  searchParams: { q?: string; former?: string };
}

export default async function ContactsPage({ searchParams }: Props) {
  const user = await requireAuth();

  // Contacts span modules; reads ride on the clients-module gate
  // (same gate the write actions use — see src/actions/contacts.ts).
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

  const q = searchParams.q?.trim() || "";
  const showFormer = searchParams.former === "1";

  const where: Prisma.ContactWhereInput = { deletedAt: null };
  if (!showFormer) where.isFormer = false;
  if (q) {
    const ci = { contains: q, mode: "insensitive" as const };
    where.OR = [{ name: ci }, { email: ci }, { organization: ci }];
  }

  const contacts = await db.contact.findMany({
    where,
    orderBy: [{ isFormer: "asc" }, { name: "asc" }],
    include: { contactLinks: { select: { entityType: true } } },
    take: 500,
  });

  // "Last touch" column: one grouped query for the visible page of
  // contacts (max occurredAt per contact) instead of a per-row N+1.
  const lastTouchRows = contacts.length
    ? await db.contactInteraction.groupBy({
        by: ["contactId"],
        where: { contactId: { in: contacts.map((c) => c.id) } },
        _max: { occurredAt: true },
      })
    : [];
  const lastTouchByContactId = new Map(
    lastTouchRows.map((row) => [row.contactId, row._max.occurredAt])
  );

  return (
    <div>
      <PageHeader
        title="Contacts"
        description="Every person you work with, across clients, suppliers, subcontractors, partners, bids, projects, and contracts"
        actions={perms.canEdit ? <ContactCreateButton /> : undefined}
      />

      <ContactsFilters
        currentSearch={q}
        showFormer={showFormer}
        resultCount={contacts.length}
      />

      {contacts.length === 0 ? (
        <EmptyState
          icon={ContactIcon}
          title={q ? "No contacts match" : "No contacts yet"}
          description={
            q
              ? "Try a different name, email, or organization."
              : "Add your first contact to start building the shared rolodex."
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="p-3 font-medium">Name</th>
                  <th className="p-3 font-medium">Title / Organization</th>
                  <th className="p-3 font-medium">Email</th>
                  <th className="p-3 font-medium">Phone</th>
                  <th className="p-3 font-medium">Linked to</th>
                  <th className="p-3 font-medium">Last touch</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((contact) => {
                  const counts = countLinksByType(contact.contactLinks);
                  const lastTouch = lastTouchByContactId.get(contact.id);
                  return (
                    <tr
                      key={contact.id}
                      className={`border-b border-border last:border-0 hover:bg-muted/50 ${contact.isFormer ? "opacity-60" : ""}`}
                    >
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/contacts/${contact.id}`}
                            className={`font-medium hover:text-primary hover:underline ${contact.isFormer ? "line-through" : ""}`}
                          >
                            {contact.name}
                          </Link>
                          {contact.isFormer && <Badge variant="outline">Former</Badge>}
                        </div>
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {[contact.title, contact.organization].filter(Boolean).join(" · ") || "—"}
                      </td>
                      <td className="p-3">
                        {contact.email ? (
                          <a
                            href={`mailto:${contact.email}`}
                            className="flex items-center gap-1.5 text-muted-foreground hover:text-primary hover:underline"
                          >
                            <Mail className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{contact.email}</span>
                          </a>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-3">
                        {contact.phone ? (
                          <a
                            href={`tel:${contact.phone}`}
                            className="flex items-center gap-1.5 text-muted-foreground hover:text-primary hover:underline"
                          >
                            <Phone className="h-3.5 w-3.5 shrink-0" />
                            {contact.phone}
                          </a>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-3">
                        {counts.length === 0 ? (
                          <span className="text-xs text-muted-foreground">Not linked</span>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {counts.map(([type, count]) => (
                              <Badge key={type} variant="outline" className="text-xs">
                                {pluralize(
                                  count,
                                  CONTACT_ENTITY_TYPE_LABELS[type].toLowerCase()
                                )}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="p-3 text-muted-foreground whitespace-nowrap">
                        {lastTouch ? formatCalendarDate(lastTouch, "MMM d, yyyy") : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** Link counts per entity type, in the canonical type order. */
function countLinksByType(
  links: { entityType: string }[]
): [ContactEntityType, number][] {
  const counts = new Map<string, number>();
  for (const link of links) {
    counts.set(link.entityType, (counts.get(link.entityType) ?? 0) + 1);
  }
  return CONTACT_ENTITY_TYPES.filter((t) => counts.has(t)).map((t) => [
    t,
    counts.get(t)!,
  ]);
}
