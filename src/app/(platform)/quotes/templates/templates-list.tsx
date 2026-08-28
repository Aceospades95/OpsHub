"use client";

import Link from "next/link";
import { toast } from "sonner";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Trash2, FilePlus2, Download, GitBranch, CornerDownRight } from "lucide-react";
import { useConfirm } from "@/components/shared/use-confirm";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { createQuote } from "@/actions/quotes";
import { deleteQuoteTemplate, createTemplateVariant } from "@/actions/quote-templates";

interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  variantOfId: string | null;
  variantLabel: string | null;
  lineItemCount: number;
  createdByName: string;
  createdById: string;
  updatedAt: string;
}

/** One rendered row: a base template, or a variant grouped under one. */
interface ListEntry {
  t: TemplateRow;
  /** Set only on variant rows whose base is present in the list. */
  baseName: string | null;
}

/**
 * Order rows base-first (keeping the server's updatedAt-desc order for
 * bases), each base immediately followed by its variants sorted by
 * label A–Z. A variant whose base isn't in the list (shouldn't happen —
 * deleting a base promotes its variants via SetNull) renders standalone.
 */
function groupTemplates(templates: TemplateRow[]): ListEntry[] {
  const byId = new Map(templates.map((t) => [t.id, t]));
  const variantsByBase = new Map<string, TemplateRow[]>();
  for (const t of templates) {
    if (t.variantOfId && byId.has(t.variantOfId)) {
      const list = variantsByBase.get(t.variantOfId) ?? [];
      list.push(t);
      variantsByBase.set(t.variantOfId, list);
    }
  }

  const entries: ListEntry[] = [];
  const emitted = new Set<string>();
  for (const t of templates) {
    if (t.variantOfId && byId.has(t.variantOfId)) continue; // rendered under its base
    entries.push({ t, baseName: null });
    emitted.add(t.id);
    const variants = (variantsByBase.get(t.id) ?? [])
      .slice()
      .sort((a, b) =>
        (a.variantLabel ?? "").localeCompare(b.variantLabel ?? "", undefined, {
          sensitivity: "base",
        })
      );
    for (const v of variants) {
      entries.push({ t: v, baseName: t.name });
      emitted.add(v.id);
    }
  }
  // Safety net for data nested deeper than one level (not creatable via
  // the app — createTemplateVariant flattens): append anything left so
  // no template silently disappears from the list.
  for (const t of templates) {
    if (!emitted.has(t.id)) {
      entries.push({ t, baseName: t.variantOfId ? byId.get(t.variantOfId)?.name ?? null : null });
    }
  }
  return entries;
}

interface Props {
  templates: TemplateRow[];
  clients: { id: string; name: string }[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export function TemplatesList({ templates, clients, canCreate, canDelete }: Props) {
  const [useTplOpen, setUseTplOpen] = useState<TemplateRow | null>(null);
  const [variantOpen, setVariantOpen] = useState<ListEntry | null>(null);
  const entries = useMemo(() => groupTemplates(templates), [templates]);
  const basesWithVariants = useMemo(() => {
    const ids = new Set<string>();
    for (const t of templates) {
      if (t.variantOfId) ids.add(t.variantOfId);
    }
    return ids;
  }, [templates]);

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Name</th>
              <th className="px-4 py-3 text-left font-medium">Items</th>
              <th className="px-4 py-3 text-left font-medium">Created by</th>
              <th className="px-4 py-3 text-left font-medium">Updated</th>
              <th className="px-4 py-3 text-right font-medium" />
            </tr>
          </thead>
          <tbody>
            {entries.map(({ t, baseName }) => (
              <tr
                key={t.id}
                className="border-t border-border hover:bg-muted/40 transition-colors"
              >
                <td className="px-4 py-3">
                  <div className={baseName ? "pl-5" : undefined}>
                    {baseName ? (
                      <div className="flex items-center gap-2">
                        <CornerDownRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <span className="text-muted-foreground">{baseName}</span>
                        {t.variantLabel && (
                          <Badge variant="secondary">{t.variantLabel}</Badge>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{t.name}</p>
                        {t.variantLabel && (
                          // Promoted variant (its base was deleted) — the
                          // label survives as a plain badge on a now-
                          // standalone template.
                          <Badge variant="secondary">{t.variantLabel}</Badge>
                        )}
                      </div>
                    )}
                    {t.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {t.description}
                      </p>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {t.lineItemCount}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  <Link
                    href={`/team/${t.createdById}`}
                    className="hover:text-primary hover:underline"
                  >
                    {t.createdByName}
                  </Link>
                </td>
                <td className="px-4 py-3 text-muted-foreground text-xs">
                  {format(new Date(t.updatedAt), "MMM d, yyyy")}
                </td>
                <td className="px-4 py-3 text-right">
                  <a
                    href={`/api/quote-templates/${t.id}/docx`}
                    className="text-muted-foreground hover:text-foreground text-xs mr-3 inline-flex items-center"
                    aria-label="Download as Word"
                  >
                    <Download className="h-3 w-3 inline mr-1" />
                    .docx
                  </a>
                  {canCreate && (
                    <button
                      onClick={() => setVariantOpen({ t, baseName })}
                      className="text-muted-foreground hover:text-foreground text-xs mr-3"
                      title="Save a copy as a labeled variant"
                    >
                      <GitBranch className="h-3 w-3 inline mr-1" />
                      New variant
                    </button>
                  )}
                  {canCreate && (
                    <button
                      onClick={() => setUseTplOpen(t)}
                      className="text-primary hover:underline text-xs mr-3"
                    >
                      <FilePlus2 className="h-3 w-3 inline mr-1" />
                      Use
                    </button>
                  )}
                  {canDelete && (
                    <DeleteButton id={t.id} hasVariants={basesWithVariants.has(t.id)} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {useTplOpen && (
        <UseTemplateDialog
          template={useTplOpen}
          clients={clients}
          onClose={() => setUseTplOpen(null)}
        />
      )}

      {variantOpen && (
        <NewVariantDialog
          template={variantOpen.t}
          baseName={variantOpen.baseName}
          onClose={() => setVariantOpen(null)}
        />
      )}
    </div>
  );
}

function DeleteButton({ id, hasVariants }: { id: string; hasVariants: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { confirm, ConfirmDialog } = useConfirm();

  async function handle() {
    const ok = await confirm({
      title: "Delete this template?",
      message: hasVariants
        ? "Existing quotes that were created from it are unaffected. Its variants become standalone templates."
        : "Existing quotes that were created from it are unaffected.",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", id);
      const res = await deleteQuoteTemplate(undefined, fd);
      if (res && "error" in res && res.error) toast.error(res.error);
      else router.refresh();
    });
  }

  return (
    <>
      <button
        onClick={handle}
        disabled={pending}
        className="text-muted-foreground hover:text-destructive p-1"
        aria-label="Delete template"
      >
        <Trash2 className="h-3 w-3" />
      </button>
      <ConfirmDialog />
    </>
  );
}

function UseTemplateDialog({
  template,
  clients,
  onClose,
}: {
  template: TemplateRow;
  clients: { id: string; name: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [clientId, setClientId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handle() {
    setError(null);
    if (!clientId) {
      setError("Choose a client");
      return;
    }
    startTransition(async () => {
      const res = await createQuote({
        fromTemplateId: template.id,
        clientId,
      });
      if ("error" in res) {
        setError(res.error ?? "Unknown error");
        return;
      }
      router.push(`/quotes/${res.id}/edit`);
    });
  }

  return (
    <Dialog open onClose={onClose} title={`Use "${template.name}"`}>
      <div className="space-y-4">
        <Select
          label="Client"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          placeholder="Select a client"
          options={clients.map((c) => ({ label: c.name, value: c.id }))}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={handle} disabled={pending}>
            {pending ? "Creating…" : "Create draft"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function NewVariantDialog({
  template,
  baseName,
  onClose,
}: {
  template: TemplateRow;
  /** Base the new variant will group under when the source is a variant. */
  baseName: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Cloning a variant flattens to its base — mirror createTemplateVariant.
  const groupName = baseName ?? template.name;

  function handle() {
    setError(null);
    startTransition(async () => {
      const res = await createTemplateVariant(template.id, label);
      if (res && "error" in res && res.error) {
        setError(res.error);
        return;
      }
      toast.success("Variant created");
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onClose={onClose} title={`New variant of "${groupName}"`}>
      <div className="space-y-4">
        <Input
          label="Variant label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Gold"
          maxLength={40}
        />
        <p className="text-xs text-muted-foreground">
          Copies this {baseName ? "variant" : "template"} — line items included —
          into a new template grouped under “{groupName}”. Each variant stays a
          full template you can edit independently.
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={handle} disabled={pending || !label.trim()}>
            {pending ? "Creating…" : "Create variant"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
