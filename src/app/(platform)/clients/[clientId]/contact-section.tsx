"use client";

import { EntityContactSection, type EntityContact } from "@/components/shared/entity-contact-section";
import { createContact, updateContact, deleteContact } from "@/actions/clients";

/** Client contacts — thin binding over the shared rolodex component. */
export function ContactSection({
  contacts,
  clientId,
  canEdit,
}: {
  contacts: EntityContact[];
  clientId: string;
  canEdit: boolean;
}) {
  return (
    <EntityContactSection
      contacts={contacts}
      parentField="clientId"
      parentId={clientId}
      canEdit={canEdit}
      actions={{ create: createContact, update: updateContact, remove: deleteContact }}
    />
  );
}
