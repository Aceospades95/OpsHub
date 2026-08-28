"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useConfirm } from "@/components/shared/use-confirm";
import { RoleTagsInput } from "@/components/shared/role-tags-input";
import {
  createContact,
  linkContact,
  searchContacts,
  unlinkContact,
  type ContactSearchHit,
} from "@/actions/contacts";
import { CONTACT_ENTITY_TYPE_LABELS, type ContactEntityType } from "@/lib/contact-types";
import { Mail, Phone, Plus, Star, X } from "lucide-react";

export interface LinkedPerson {
  linkId: string;
  contactId: string;
  roles: string[];
  isPrimary: boolean;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  isFormer: boolean;
  /** Only populated for departed people (mailbox-redirect info etc.). */
  notes: string | null;
}

/**
 * Client half of ContactLinksCard: renders the linked people plus the
 * "Add person" dialog (search the unified rolodex, or create a new
 * contact inline and link them in one go). Rows link to the person's
 * /contacts page; former people render struck-through and dimmed.
 */
export function ContactLinksCardClient({
  entityType,
  entityId,
  people,
  canEdit,
}: {
  entityType: ContactEntityType;
  entityId: string;
  people: LinkedPerson[];
  canEdit: boolean;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [isPending, startTransition] = useTransition();
  const { confirm, ConfirmDialog } = useConfirm();
  const router = useRouter();

  const entityLabel = CONTACT_ENTITY_TYPE_LABELS[entityType].toLowerCase();

  // A 39-person client renders a ~3,900px card without this: big lists
  // get an inline filter and an internal scroll region so the card
  // stays one screen tall. Small lists render exactly as before.
  const isLargeList = people.length > 8;
  const q = filter.trim().toLowerCase();
  const visiblePeople =
    isLargeList && q
      ? people.filter((p) =>
          [p.name, p.title, p.email, ...p.roles]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q))
        )
      : people;

  async function handleUnlink(person: LinkedPerson) {
    const ok = await confirm({
      title: `Remove "${person.name}"?`,
      message: `This only removes the link to this ${entityLabel} — the contact stays in the rolodex.`,
      confirmLabel: "Remove",
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await unlinkContact(person.linkId);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Contact removed");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {people.length === 0 && (
        <p className="text-sm text-muted-foreground">No people linked yet</p>
      )}

      {isLargeList && (
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={`Filter ${people.length} people by name, role, or email…`}
          aria-label="Filter linked people"
        />
      )}
      {isLargeList && q && visiblePeople.length === 0 && (
        <p className="text-sm text-muted-foreground">No people match the filter.</p>
      )}

      <div className={isLargeList ? "max-h-[28rem] space-y-3 overflow-y-auto pr-1" : "space-y-3"}>
      {visiblePeople.map((person) => (
        <div
          key={person.linkId}
          className={`rounded border border-border bg-muted p-3 ${person.isFormer ? "opacity-60" : ""}`}
        >
          <div className="flex items-start justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/contacts/${person.contactId}`}
                  className={`text-sm font-medium hover:text-primary hover:underline ${person.isFormer ? "line-through" : ""}`}
                >
                  {person.name}
                </Link>
                {person.isPrimary && (
                  <Badge variant="success" className="text-xs">
                    <Star className="h-3 w-3 mr-0.5" />
                    Primary
                  </Badge>
                )}
                {person.isFormer && (
                  <Badge variant="outline" className="text-xs">
                    Former
                  </Badge>
                )}
              </div>
              {person.title && (
                <p className="text-xs text-muted-foreground">{person.title}</p>
              )}
              {person.roles.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {person.roles.map((role) => (
                    <Badge key={role} variant="secondary" className="text-xs">
                      {role}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            {canEdit && (
              <button
                onClick={() => handleUnlink(person)}
                disabled={isPending}
                aria-label={`Remove ${person.name}`}
                title={`Remove ${person.name}`}
                className="rounded p-1 text-muted-foreground hover:text-destructive disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="mt-2 space-y-1">
            {person.email && (
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <Mail className="h-3 w-3 shrink-0" />
                <a
                  href={`mailto:${person.email}`}
                  className="hover:text-primary hover:underline truncate"
                >
                  {person.email}
                </a>
              </p>
            )}
            {person.phone && (
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <Phone className="h-3 w-3 shrink-0" />
                <a href={`tel:${person.phone}`} className="hover:text-primary hover:underline">
                  {person.phone}
                </a>
              </p>
            )}
            {person.isFormer && person.notes && (
              <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                {person.notes}
              </p>
            )}
          </div>
        </div>
      ))}
      </div>

      {canEdit && (
        <>
          <Button variant="outline" size="sm" className="w-full" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Add Person
          </Button>
          {addOpen && (
            <AddPersonDialog
              entityType={entityType}
              entityId={entityId}
              linkedContactIds={people.map((p) => p.contactId)}
              onClose={() => setAddOpen(false)}
            />
          )}
        </>
      )}
      <ConfirmDialog />
    </div>
  );
}

/**
 * Two-mode add dialog: pick an existing contact from the unified
 * rolodex, or create a brand-new one inline. Both paths end with a
 * ContactLink to this entity carrying the optional role.
 */
function AddPersonDialog({
  entityType,
  entityId,
  linkedContactIds,
  onClose,
}: {
  entityType: ContactEntityType;
  entityId: string;
  linkedContactIds: string[];
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"search" | "create">("search");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ContactSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<ContactSearchHit | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  // Create-new fields
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const linkedSet = new Set(linkedContactIds);

  // Debounced rolodex search.
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
        const hits = await searchContacts(trimmed);
        setResults(hits);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  function handleLinkExisting() {
    if (!selected) return;
    startTransition(async () => {
      const result = await linkContact(selected.id, entityType, entityId, roles);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`Linked ${selected.name}`);
      onClose();
      router.refresh();
    });
  }

  function handleCreateAndLink() {
    if (!newName.trim()) {
      toast.error("Name is required");
      return;
    }
    startTransition(async () => {
      const created = await createContact({
        name: newName,
        email: newEmail || undefined,
        title: newTitle || undefined,
      });
      if (created?.error || !created?.contactId) {
        toast.error(
          created?.fieldErrors?.name?.[0] ??
            created?.fieldErrors?.email?.[0] ??
            created?.error ??
            "Could not create contact"
        );
        return;
      }
      const linked = await linkContact(created.contactId, entityType, entityId, roles);
      if (linked?.error) {
        toast.error(linked.error);
        return;
      }
      toast.success(`Added ${newName.trim()}`);
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Add Person"
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          {mode === "search" ? (
            <Button onClick={handleLinkExisting} disabled={isPending || !selected}>
              {isPending ? "Linking…" : "Link Contact"}
            </Button>
          ) : (
            <Button onClick={handleCreateAndLink} disabled={isPending || !newName.trim()}>
              {isPending ? "Adding…" : "Create & Link"}
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex gap-1 rounded border border-border p-1 text-sm">
          <button
            type="button"
            onClick={() => setMode("search")}
            className={`flex-1 rounded px-2 py-1 transition-colors ${mode === "search" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
          >
            Existing contact
          </button>
          <button
            type="button"
            onClick={() => setMode("create")}
            className={`flex-1 rounded px-2 py-1 transition-colors ${mode === "create" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
          >
            New contact
          </button>
        </div>

        {mode === "search" ? (
          <>
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
                  <p className="p-3 text-xs text-muted-foreground">
                    No matching contacts — switch to &ldquo;New contact&rdquo; to create one.
                  </p>
                ) : (
                  results.map((hit) => {
                    const alreadyLinked = linkedSet.has(hit.id);
                    return (
                      <button
                        key={hit.id}
                        type="button"
                        disabled={alreadyLinked}
                        onClick={() => setSelected(hit)}
                        className={`flex w-full items-center justify-between gap-2 p-2 text-left text-sm transition-colors ${
                          selected?.id === hit.id ? "bg-primary/10" : "hover:bg-muted"
                        } ${alreadyLinked ? "opacity-50 cursor-not-allowed" : ""}`}
                      >
                        <span className="min-w-0">
                          <span className={`block truncate font-medium ${hit.isFormer ? "line-through" : ""}`}>
                            {hit.name}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {[hit.title, hit.organization, hit.email].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                        {alreadyLinked && (
                          <Badge variant="outline" className="text-xs shrink-0">
                            Linked
                          </Badge>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <Input
              label="Name"
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              autoFocus
            />
            <Input
              label="Email"
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
            <Input
              label="Job Title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
            />
          </>
        )}

        <RoleTagsInput
          label={`Roles on this ${CONTACT_ENTITY_TYPE_LABELS[entityType].toLowerCase()}`}
          value={roles}
          onChange={setRoles}
          disabled={isPending}
        />
      </div>
    </Dialog>
  );
}
