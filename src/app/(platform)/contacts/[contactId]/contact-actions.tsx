"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useConfirm } from "@/components/shared/use-confirm";
import { GitMerge, Pencil, Trash2 } from "lucide-react";
import {
  mergeContacts,
  searchContacts,
  softDeleteContact,
  updateContact,
  type ContactSearchHit,
} from "@/actions/contacts";
import { ContactFormDialog } from "../contact-form-dialog";

interface ContactRecord {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  organization: string | null;
  notes: string | null;
  isFormer: boolean;
}

/** Header actions on the contact detail page: edit, merge (ADMIN), delete. */
export function ContactActions({
  contact,
  canEdit,
  isAdmin,
}: {
  contact: ContactRecord;
  canEdit: boolean;
  isAdmin: boolean;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const { confirm, ConfirmDialog } = useConfirm();
  const router = useRouter();

  if (!canEdit) return null;

  async function handleDelete() {
    const ok = await confirm({
      title: `Delete contact "${contact.name}"?`,
      message:
        "The contact is removed from every linked client, supplier, project, and other record. Links are kept for recovery.",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await softDeleteContact(contact.id);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Contact deleted");
      router.push("/contacts");
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="outline" onClick={() => setEditOpen(true)}>
        <Pencil className="h-4 w-4 mr-1" />
        Edit
      </Button>
      {isAdmin && (
        <Button variant="outline" onClick={() => setMergeOpen(true)}>
          <GitMerge className="h-4 w-4 mr-1" />
          Merge
        </Button>
      )}
      <Button variant="destructive" onClick={handleDelete} disabled={isPending}>
        <Trash2 className="h-4 w-4 mr-1" />
        Delete
      </Button>

      {editOpen && (
        <ContactFormDialog
          title="Edit Contact"
          submitLabel="Save"
          showIsFormer
          initial={{
            name: contact.name,
            title: contact.title ?? "",
            email: contact.email ?? "",
            phone: contact.phone ?? "",
            organization: contact.organization ?? "",
            notes: contact.notes ?? "",
            isFormer: contact.isFormer,
          }}
          onClose={() => setEditOpen(false)}
          onSubmit={async (values) => {
            const result = await updateContact(contact.id, values);
            if (result.error) return result;
            toast.success("Contact updated");
            setEditOpen(false);
            router.refresh();
          }}
        />
      )}

      {mergeOpen && (
        <MergeContactDialog keep={contact} onClose={() => setMergeOpen(false)} />
      )}
      <ConfirmDialog />
    </>
  );
}

/**
 * ADMIN-only merge: pick another contact by search; its links move to
 * THIS contact, blank fields here are filled from it, and it is then
 * soft-deleted.
 */
function MergeContactDialog({
  keep,
  onClose,
}: {
  keep: ContactRecord;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ContactSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<ContactSearchHit | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        // Duplicates being cleaned up may themselves be departed —
        // the merge picker is the one place former contacts stay in.
        const hits = await searchContacts(trimmed, { includeFormer: true });
        setResults(hits.filter((h) => h.id !== keep.id));
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query, keep.id]);

  function handleMerge() {
    if (!selected) return;
    startTransition(async () => {
      const result = await mergeContacts(keep.id, selected.id);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`Merged "${selected.name}" into "${keep.name}"`);
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Merge Contacts"
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleMerge}
            disabled={isPending || !selected}
          >
            {isPending ? "Merging…" : "Merge"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Pick a duplicate to merge into <span className="font-medium text-foreground">{keep.name}</span>.
          Its links move here, blank fields are filled from it, and the duplicate is deleted.
        </p>
        <Input
          label="Search contacts"
          placeholder="Name or email…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(null);
          }}
          autoFocus
        />
        {query.trim().length > 0 && (
          <div className="max-h-48 overflow-y-auto rounded border border-border divide-y divide-border">
            {searching && results.length === 0 ? (
              <p className="p-3 text-xs text-muted-foreground">Searching…</p>
            ) : results.length === 0 ? (
              <p className="p-3 text-xs text-muted-foreground">No other contacts match.</p>
            ) : (
              results.map((hit) => (
                <button
                  key={hit.id}
                  type="button"
                  onClick={() => setSelected(hit)}
                  className={`flex w-full items-center justify-between gap-2 p-2 text-left text-sm transition-colors ${
                    selected?.id === hit.id ? "bg-primary/10" : "hover:bg-muted"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{hit.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[hit.title, hit.organization, hit.email].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  {hit.isFormer && (
                    <Badge variant="outline" className="text-xs shrink-0">
                      Former
                    </Badge>
                  )}
                </button>
              ))
            )}
          </div>
        )}
        {selected && (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">&ldquo;{selected.name}&rdquo;</span> will be
            merged into &ldquo;{keep.name}&rdquo; and deleted. This can&apos;t be undone from the UI.
          </p>
        )}
      </div>
    </Dialog>
  );
}
