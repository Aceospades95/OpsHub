"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormDialog } from "@/components/shared/form-dialog";
import { useConfirm } from "@/components/shared/use-confirm";
import { Badge } from "@/components/ui/badge";
import {
  createSupplierContact,
  updateSupplierContact,
  deleteSupplierContact,
} from "@/actions/suppliers";
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
  supplierId: string;
  canEdit: boolean;
}

/**
 * Supplier contact list — mirrors the client ContactSection. Multiple
 * emails/phones per supplier = multiple contact rows ("AP dept",
 * "John — cell", "Main office fax"), each with its own title.
 */
export function SupplierContactSection({ contacts, supplierId, canEdit }: Props) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const [isPending, startTransition] = useTransition();
  const { confirm, ConfirmDialog } = useConfirm();
  const router = useRouter();

  async function handleDelete(id: string, name: string) {
    const ok = await confirm({
      title: `Delete contact "${name}"?`,
      message: "This can't be undone.",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", id);
      const result = await deleteSupplierContact(null, fd);
      if (result && "error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Contact deleted");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {contacts.length === 0 && (
        <p className="text-sm text-muted-foreground">No additional contacts</p>
      )}

      {contacts.map((contact) => (
        <div key={contact.id} className="rounded border border-border bg-muted p-3">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">{contact.name}</p>
                {contact.isPrimary && (
                  <Badge variant="success" className="text-xs">
                    <Star className="h-3 w-3 mr-0.5" />
                    Primary
                  </Badge>
                )}
              </div>
              {contact.title && (
                <p className="text-xs text-muted-foreground">{contact.title}</p>
              )}
            </div>
            {canEdit && (
              <div className="flex gap-1">
                <button
                  onClick={() => setEditContact(contact)}
                  aria-label={`Edit contact ${contact.name}`}
                  className="rounded p-1 text-muted-foreground hover:text-foreground"
                >
                  <Pencil className="h-3 w-3" />
                </button>
                <button
                  onClick={() => handleDelete(contact.id, contact.name)}
                  disabled={isPending}
                  aria-label={`Delete contact ${contact.name}`}
                  className="rounded p-1 text-muted-foreground hover:text-destructive disabled:opacity-50"
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
            {contact.notes && (
              <p className="text-xs text-muted-foreground whitespace-pre-wrap">{contact.notes}</p>
            )}
          </div>
        </div>
      ))}

      {canEdit && (
        <>
          <Button variant="outline" size="sm" className="w-full" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Add Contact
          </Button>

          <FormDialog
            open={createOpen}
            onClose={() => setCreateOpen(false)}
            title="Add Contact"
            action={createSupplierContact}
          >
            {({ fieldErrors }) => (
              <>
                <input type="hidden" name="supplierId" value={supplierId} />
                <Input name="name" label="Name" required error={fieldErrors?.name?.[0]} />
                <Input name="title" label="Job Title" />
                <Input name="email" label="Email" type="email" />
                <Input name="phone" label="Phone" />
                <Textarea
                  name="notes"
                  label="Notes"
                  placeholder='e.g. "Personal email", "Fax", "Cell — after hours"'
                />
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
              action={updateSupplierContact}
            >
              {({ fieldErrors }) => (
                <>
                  <input type="hidden" name="id" value={editContact.id} />
                  <input type="hidden" name="supplierId" value={supplierId} />
                  <Input name="name" label="Name" defaultValue={editContact.name} required error={fieldErrors?.name?.[0]} />
                  <Input name="title" label="Job Title" defaultValue={editContact.title || ""} />
                  <Input name="email" label="Email" type="email" defaultValue={editContact.email || ""} />
                  <Input name="phone" label="Phone" defaultValue={editContact.phone || ""} />
                  <Textarea name="notes" label="Notes" defaultValue={editContact.notes || ""} />
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="isPrimary"
                      value="true"
                      defaultChecked={editContact.isPrimary}
                      className="rounded"
                    />
                    Primary contact
                  </label>
                </>
              )}
            </FormDialog>
          )}
        </>
      )}
      <ConfirmDialog />
    </div>
  );
}
