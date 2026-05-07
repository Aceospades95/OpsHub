"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormDialog } from "@/components/shared/form-dialog";
import { Badge } from "@/components/ui/badge";
import {
  createSubcontractorContact,
  updateSubcontractorContact,
  deleteSubcontractorContact,
} from "@/actions/subcontractors";
import { Plus, Pencil, Trash2, Mail, Phone, Star } from "lucide-react";

interface Contact {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
  notes: string | null;
}

interface Props {
  contacts: Contact[];
  subcontractorId: string;
  canEdit: boolean;
}

export function SubcontractorContacts({ contacts, subcontractorId, canEdit }: Props) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const router = useRouter();

  async function handleDelete(id: string) {
    const fd = new FormData();
    fd.set("id", id);
    await deleteSubcontractorContact(null, fd);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {contacts.length === 0 && <p className="text-sm text-muted-foreground">No contacts</p>}

      {contacts.map((contact) => (
        <div key={contact.id} className="rounded border border-border bg-muted p-3">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">{contact.name}</p>
                {contact.isPrimary && (
                  <Badge variant="success" className="text-xs">
                    <Star className="h-3 w-3 mr-0.5" /> Primary
                  </Badge>
                )}
              </div>
              {contact.title && <p className="text-xs text-muted-foreground">{contact.title}</p>}
            </div>
            {canEdit && (
              <div className="flex gap-1">
                <button
                  onClick={() => setEditContact(contact)}
                  className="rounded p-1 text-muted-foreground hover:text-foreground"
                  aria-label="Edit contact"
                  title="Edit contact"
                >
                  <Pencil className="h-3 w-3" />
                </button>
                <button
                  onClick={() => handleDelete(contact.id)}
                  className="rounded p-1 text-muted-foreground hover:text-destructive"
                  aria-label="Remove contact"
                  title="Remove contact"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
          <div className="mt-2 space-y-1">
            {contact.email && (
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <Mail className="h-3 w-3" /> {contact.email}
              </p>
            )}
            {contact.phone && (
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <Phone className="h-3 w-3" /> {contact.phone}
              </p>
            )}
          </div>
        </div>
      ))}

      {canEdit && (
        <>
          <Button variant="outline" size="sm" className="w-full" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Add Contact
          </Button>

          <FormDialog
            open={createOpen}
            onClose={() => setCreateOpen(false)}
            title="Add Contact"
            action={createSubcontractorContact}
          >
            {({ fieldErrors }) => (
              <>
                <input type="hidden" name="subcontractorId" value={subcontractorId} />
                <Input name="name" label="Name" required error={fieldErrors?.name?.[0]} />
                <Input name="title" label="Job Title" />
                <Input name="email" label="Email" type="email" />
                <Input name="phone" label="Phone" />
                <Textarea name="notes" label="Notes" />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="isPrimary" value="true" className="rounded" />
                  Primary contact
                </label>
              </>
            )}
          </FormDialog>

          {editContact && (
            <FormDialog
              open={!!editContact}
              onClose={() => setEditContact(null)}
              title="Edit Contact"
              action={updateSubcontractorContact}
            >
              {({ fieldErrors }) => (
                <>
                  <input type="hidden" name="id" value={editContact.id} />
                  <input type="hidden" name="subcontractorId" value={subcontractorId} />
                  <Input name="name" label="Name" defaultValue={editContact.name} required error={fieldErrors?.name?.[0]} />
                  <Input name="title" label="Job Title" defaultValue={editContact.title || ""} />
                  <Input name="email" label="Email" type="email" defaultValue={editContact.email || ""} />
                  <Input name="phone" label="Phone" defaultValue={editContact.phone || ""} />
                  <Textarea name="notes" label="Notes" defaultValue={editContact.notes || ""} />
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="isPrimary" value="true" defaultChecked={editContact.isPrimary} className="rounded" />
                    Primary contact
                  </label>
                </>
              )}
            </FormDialog>
          )}
        </>
      )}
    </div>
  );
}
