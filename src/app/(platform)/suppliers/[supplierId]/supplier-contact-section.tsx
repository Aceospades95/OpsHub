"use client";

import { EntityContactSection, type EntityContact } from "@/components/shared/entity-contact-section";
import {
  createSupplierContact,
  updateSupplierContact,
  deleteSupplierContact,
} from "@/actions/suppliers";

/**
 * Supplier contacts — thin binding over the shared rolodex component.
 * Multiple emails/phones per supplier = multiple contact rows ("AP
 * dept", "John — cell", "Main office fax"), each with its own title.
 */
export function SupplierContactSection({
  contacts,
  supplierId,
  canEdit,
}: {
  contacts: EntityContact[];
  supplierId: string;
  canEdit: boolean;
}) {
  return (
    <EntityContactSection
      contacts={contacts}
      parentField="supplierId"
      parentId={supplierId}
      canEdit={canEdit}
      actions={{
        create: createSupplierContact,
        update: updateSupplierContact,
        remove: deleteSupplierContact,
      }}
      emptyText="No contacts yet — add the people (and departments) you deal with."
      showNotesInCard
      notesPlaceholder='e.g. "Use for orders over $5k" or "Prefers text"'
    />
  );
}
