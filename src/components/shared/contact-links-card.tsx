import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { getContactsFor, type ContactEntityType } from "@/lib/contacts";
import { ContactLinksCardClient } from "./contact-links-card-client";

/**
 * The linked-people card every entity detail page mounts (suppliers,
 * subcontractors, partnerships, projects — clients adopt it via their
 * own workstream). Server component: fetches the entity's active
 * ContactLinks itself, so mount sites only pass entityType + entityId.
 *
 * Write controls (Add person / unlink) follow the contacts write gate
 * (clients-module canEdit — see src/actions/contacts.ts), resolved
 * here so the buttons can never appear for a caller whose action
 * would be denied. Read visibility is the mounting page's concern —
 * it already gated on its own module's canView.
 */
export async function ContactLinksCard({
  entityType,
  entityId,
  title = "Contacts",
  className,
}: {
  entityType: ContactEntityType;
  entityId: string;
  /** Card heading — e.g. "People involved" on project pages. */
  title?: string;
  className?: string;
}) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "clients");
  const links = await getContactsFor(entityType, entityId);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>
          {title} ({links.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ContactLinksCardClient
          entityType={entityType}
          entityId={entityId}
          canEdit={perms.canEdit}
          people={links.map((link) => ({
            linkId: link.id,
            contactId: link.contactId,
            roles: link.roles,
            isPrimary: link.isPrimary,
            name: link.contact.name,
            title: link.contact.title,
            email: link.contact.email,
            phone: link.contact.phone,
            isFormer: link.contact.isFormer,
            // Departed people's notes often carry the mailbox-redirect
            // info ("redirects to servicemanagers@") — shown on the row.
            notes: link.contact.isFormer ? link.contact.notes : null,
          }))}
        />
      </CardContent>
    </Card>
  );
}
