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
import { Plus, Pencil, Trash2, Mail, Phone, Star } from "lucide-react";

export interface EntityContact {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
  notes: string | null;
}

type ContactAction = (
  prev: unknown,
  formData: FormData
) => Promise<{ success?: boolean; error?: string; fieldErrors?: Record<string, string[]> }>;

/**
 * The contact rolodex shared by every entity that has contacts (clients,
 * suppliers — subcontractors/partnerships can adopt it later): primary
 * badge, edit/delete per row, create/edit dialogs with one shared field
 * set. Callers stay one-liner wrappers that bind their own server
 * actions and parent-id field name, so the layout and behavior can't
 * drift between modules again.
 */
export function EntityContactSection({
  contacts,
  parentField,
  parentId,
  canEdit,
  actions,
  emptyText = "No contacts",
  showNotesInCard = false,
  notesPlaceholder,
}: {
  contacts: EntityContact[];
  /** Hidden-input name carrying the parent id, e.g. "clientId". */
  parentField: string;
  parentId: string;
  canEdit: boolean;
  actions: { create: ContactAction; update: ContactAction; remove: ContactAction };
  emptyText?: string;
  /** Suppliers show contact notes on the card; clients keep them dialog-only. */
  showNotesInCard?: boolean;
  notesPlaceholder?: string;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editContact, setEditContact] = useState<EntityContact | null>(null);
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
      const result = await actions.remove(null, fd);
      if (result && "error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Contact deleted");
      router.refresh();
    });
  }

  const contactFields = (contact: EntityContact | null, fieldErrors?: Record<string, string[]>) => (
    <>
      {contact && <input type="hidden" name="id" value={contact.id} />}
      <input type="hidden" name={parentField} value={parentId} />
      <Input name="name" label="Name" required defaultValue={contact?.name ?? ""} error={fieldErrors?.name?.[0]} />
      <Input name="title" label="Job Title" defaultValue={contact?.title ?? ""} />
      <Input name="email" label="Email" type="email" defaultValue={contact?.email ?? ""} />
      <Input name="phone" label="Phone" defaultValue={contact?.phone ?? ""} />
      <Textarea name="notes" label="Notes" placeholder={notesPlaceholder} defaultValue={contact?.notes ?? ""} />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="isPrimary"
          value="true"
          defaultChecked={contact?.isPrimary ?? false}
          className="rounded"
        />
        Primary contact
      </label>
    </>
  );

  return (
    <div className="space-y-3">
      {contacts.length === 0 && <p className="text-sm text-muted-foreground">{emptyText}</p>}

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
              {contact.title && <p className="text-xs text-muted-foreground">{contact.title}</p>}
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
            {showNotesInCard && contact.notes && (
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

          <FormDialog open={createOpen} onClose={() => setCreateOpen(false)} title="Add Contact" action={actions.create}>
            {({ fieldErrors }) => contactFields(null, fieldErrors)}
          </FormDialog>

          {editContact && (
            <FormDialog
              open={!!editContact}
              onClose={() => setEditContact(null)}
              title="Edit Contact"
              action={actions.update}
            >
              {({ fieldErrors }) => contactFields(editContact, fieldErrors)}
            </FormDialog>
          )}
        </>
      )}
      <ConfirmDialog />
    </div>
  );
}
