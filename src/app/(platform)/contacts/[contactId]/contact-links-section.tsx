"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useConfirm } from "@/components/shared/use-confirm";
import { RoleTagsInput } from "@/components/shared/role-tags-input";
import {
  linkContact,
  searchLinkTargets,
  unlinkContact,
  updateContactLink,
} from "@/actions/contacts";
import {
  CONTACT_ENTITY_TYPES,
  CONTACT_ENTITY_TYPE_LABELS,
  type ContactEntityType,
} from "@/lib/contact-types";
import { Check, Pencil, Plus, Star, X } from "lucide-react";

export interface ResolvedContactLink {
  id: string;
  entityType: ContactEntityType;
  roles: string[];
  isPrimary: boolean;
  targetName: string;
  targetHref: string;
}

/**
 * "Linked to" card body on the contact detail page: resolved targets
 * with role tags + primary star, inline role-tag editing, unlink, and
 * the add-link picker (entity type → search that type → role tags →
 * link).
 */
export function ContactLinksSection({
  contactId,
  links,
  canEdit,
}: {
  contactId: string;
  links: ResolvedContactLink[];
  canEdit: boolean;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [editingRolesId, setEditingRolesId] = useState<string | null>(null);
  const [rolesDraft, setRolesDraft] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();
  const { confirm, ConfirmDialog } = useConfirm();
  const router = useRouter();

  async function handleUnlink(link: ResolvedContactLink) {
    const ok = await confirm({
      title: `Unlink from "${link.targetName}"?`,
      message: "Only the relationship is removed — the contact itself stays.",
      confirmLabel: "Unlink",
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await unlinkContact(link.id);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Link removed");
      router.refresh();
    });
  }

  function handleSaveRoles(linkId: string) {
    startTransition(async () => {
      const result = await updateContactLink(linkId, { roles: rolesDraft });
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      setEditingRolesId(null);
      toast.success("Role tags updated");
      router.refresh();
    });
  }

  function handleTogglePrimary(link: ResolvedContactLink) {
    startTransition(async () => {
      const result = await updateContactLink(link.id, { isPrimary: !link.isPrimary });
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success(link.isPrimary ? "Primary flag cleared" : "Marked as primary contact");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {links.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Not linked to anything yet — link this person to the records they belong to.
        </p>
      )}

      {links.map((link) => (
        <div
          key={link.id}
          className="flex items-start justify-between gap-3 rounded border border-border bg-muted p-3"
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="text-xs">
                {CONTACT_ENTITY_TYPE_LABELS[link.entityType]}
              </Badge>
              <Link
                href={link.targetHref}
                className="text-sm font-medium hover:text-primary hover:underline truncate"
              >
                {link.targetName}
              </Link>
              {link.isPrimary && (
                <Badge variant="success" className="text-xs">
                  <Star className="h-3 w-3 mr-0.5" />
                  Primary
                </Badge>
              )}
            </div>
            {editingRolesId === link.id ? (
              <div className="mt-2 space-y-2">
                <RoleTagsInput
                  label="Role tags"
                  value={rolesDraft}
                  onChange={setRolesDraft}
                  disabled={isPending}
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => handleSaveRoles(link.id)}
                    disabled={isPending}
                  >
                    <Check className="h-3.5 w-3.5 mr-1" />
                    {isPending ? "Saving…" : "Save"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditingRolesId(null)}
                    disabled={isPending}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : link.roles.length > 0 ? (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {link.roles.map((role) => (
                  <Badge key={role} variant="secondary" className="text-xs">
                    {role}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">No role tags</p>
            )}
          </div>

          {canEdit && editingRolesId !== link.id && (
            <div className="flex shrink-0 gap-1">
              <button
                onClick={() => handleTogglePrimary(link)}
                disabled={isPending}
                aria-label={
                  link.isPrimary
                    ? `Clear primary flag on ${link.targetName}`
                    : `Make primary contact on ${link.targetName}`
                }
                title={link.isPrimary ? "Clear primary flag" : "Make primary contact"}
                className={`rounded p-1 disabled:opacity-50 ${
                  link.isPrimary
                    ? "text-warning hover:text-muted-foreground"
                    : "text-muted-foreground hover:text-warning"
                }`}
              >
                <Star className={`h-3.5 w-3.5 ${link.isPrimary ? "fill-current" : ""}`} />
              </button>
              <button
                onClick={() => {
                  setRolesDraft(link.roles);
                  setEditingRolesId(link.id);
                }}
                aria-label={`Edit role tags on ${link.targetName}`}
                title="Edit role tags"
                className="rounded p-1 text-muted-foreground hover:text-foreground"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => handleUnlink(link)}
                disabled={isPending}
                aria-label={`Unlink from ${link.targetName}`}
                title="Unlink"
                className="rounded p-1 text-muted-foreground hover:text-destructive disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      ))}

      {canEdit && !addOpen && (
        <Button variant="outline" size="sm" className="w-full" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Add Link
        </Button>
      )}

      {canEdit && addOpen && (
        <AddLinkForm contactId={contactId} onClose={() => setAddOpen(false)} />
      )}
      <ConfirmDialog />
    </div>
  );
}

/**
 * Inline add-link picker: entity-type select → server-action search of
 * that type by name → optional role tags → link.
 */
function AddLinkForm({ contactId, onClose }: { contactId: string; onClose: () => void }) {
  const [entityType, setEntityType] = useState<ContactEntityType>("client");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ id: string; name: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [isPrimary, setIsPrimary] = useState(false);
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
        const hits = await searchLinkTargets(entityType, trimmed);
        setResults(hits);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query, entityType]);

  function handleLink() {
    if (!selected) return;
    startTransition(async () => {
      const result = await linkContact(contactId, entityType, selected.id, roles, isPrimary);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`Linked to ${selected.name}`);
      onClose();
      router.refresh();
    });
  }

  return (
    <div className="space-y-3 rounded border border-border p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Select
          label="Record type"
          value={entityType}
          onChange={(e) => {
            setEntityType(e.target.value as ContactEntityType);
            setResults([]);
            setSelected(null);
            setQuery("");
          }}
          options={CONTACT_ENTITY_TYPES.map((t) => ({
            value: t,
            label: CONTACT_ENTITY_TYPE_LABELS[t],
          }))}
        />
        <Input
          label={`Search ${CONTACT_ENTITY_TYPE_LABELS[entityType].toLowerCase()}s`}
          placeholder="Type a name…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(null);
          }}
        />
      </div>

      {query.trim().length > 0 && !selected && (
        <div className="max-h-40 overflow-y-auto rounded border border-border divide-y divide-border">
          {searching && results.length === 0 ? (
            <p className="p-2 text-xs text-muted-foreground">Searching…</p>
          ) : results.length === 0 ? (
            <p className="p-2 text-xs text-muted-foreground">
              No matching {CONTACT_ENTITY_TYPE_LABELS[entityType].toLowerCase()}s.
            </p>
          ) : (
            results.map((hit) => (
              <button
                key={hit.id}
                type="button"
                onClick={() => setSelected(hit)}
                className="block w-full p-2 text-left text-sm hover:bg-muted"
              >
                {hit.name}
              </button>
            ))
          )}
        </div>
      )}

      {selected && (
        <p className="text-xs text-muted-foreground">
          Linking to <span className="font-medium text-foreground">{selected.name}</span>
        </p>
      )}

      <RoleTagsInput value={roles} onChange={setRoles} disabled={isPending} />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={isPrimary}
          onChange={(e) => setIsPrimary(e.target.checked)}
          className="rounded"
        />
        Primary contact for this record
      </label>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={isPending}>
          Cancel
        </Button>
        <Button size="sm" onClick={handleLink} disabled={isPending || !selected}>
          {isPending ? "Linking…" : "Link"}
        </Button>
      </div>
    </div>
  );
}
