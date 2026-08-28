"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useConfirm } from "@/components/shared/use-confirm";
import { formatCalendarDate, toCalendarDateString } from "@/lib/dates";
import { deleteInteraction, logInteraction, updateInteraction } from "@/actions/interactions";
import {
  INTERACTION_KINDS,
  INTERACTION_KIND_LABELS,
  isInteractionKind,
} from "./interaction-kinds";
import { Pencil, Plus, Trash2 } from "lucide-react";

export interface InteractionItem {
  id: string;
  kind: string;
  /** ISO timestamp — rendered via formatCalendarDate. */
  occurredAt: string;
  summary: string;
  notes: string | null;
  createdById: string | null;
  createdByName: string | null;
}

/** Display label for a stored kind — tolerant of rows predating a set change. */
function kindLabel(kind: string): string {
  return isInteractionKind(kind) ? INTERACTION_KIND_LABELS[kind] : kind;
}

/**
 * "Interactions" card body on the contact detail page: reverse-
 * chronological touch log (the server component orders by occurredAt
 * desc) with the log-interaction dialog, plus edit / delete on each
 * entry for its author or an ADMIN (the server actions re-check both).
 */
export function InteractionsSection({
  contactId,
  interactions,
  canEdit,
  currentUserId,
  isAdmin,
}: {
  contactId: string;
  interactions: InteractionItem[];
  canEdit: boolean;
  currentUserId: string;
  isAdmin: boolean;
}) {
  const [logOpen, setLogOpen] = useState(false);
  const [editing, setEditing] = useState<InteractionItem | null>(null);
  const [isPending, startTransition] = useTransition();
  const { confirm, ConfirmDialog } = useConfirm();
  const router = useRouter();

  async function handleDelete(interaction: InteractionItem) {
    const ok = await confirm({
      title: "Delete this interaction?",
      message: `"${interaction.summary}" is removed from the timeline. Unlike the contact itself, this can't be undone.`,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await deleteInteraction(interaction.id);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Interaction deleted");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {canEdit && (
        <Button variant="outline" size="sm" className="w-full" onClick={() => setLogOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Log Interaction
        </Button>
      )}

      {interactions.length === 0 && (
        <p className="text-sm text-muted-foreground">No interactions logged yet</p>
      )}

      {interactions.map((interaction) => (
        <div
          key={interaction.id}
          className="flex items-start justify-between gap-3 rounded border border-border bg-muted p-3"
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="text-xs">
                {kindLabel(interaction.kind)}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {formatCalendarDate(interaction.occurredAt, "MMM d, yyyy")}
              </span>
              {interaction.createdByName && (
                <span className="text-xs text-muted-foreground truncate">
                  · {interaction.createdByName}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm font-medium">{interaction.summary}</p>
            {interaction.notes && (
              <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">
                {interaction.notes}
              </p>
            )}
          </div>

          {canEdit && (isAdmin || interaction.createdById === currentUserId) && (
            <div className="flex shrink-0 gap-1">
              <button
                onClick={() => setEditing(interaction)}
                aria-label={`Edit interaction "${interaction.summary}"`}
                title="Edit interaction"
                className="rounded p-1 text-muted-foreground hover:text-foreground"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => handleDelete(interaction)}
                disabled={isPending}
                aria-label={`Delete interaction "${interaction.summary}"`}
                title="Delete interaction"
                className="rounded p-1 text-muted-foreground hover:text-destructive disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      ))}

      {logOpen && (
        <InteractionFormDialog
          title="Log Interaction"
          submitLabel="Log"
          onClose={() => setLogOpen(false)}
          onSubmit={async (values) => {
            const result = await logInteraction({ contactId, ...values });
            if (result.error) return result;
            toast.success("Interaction logged");
            setLogOpen(false);
            router.refresh();
          }}
        />
      )}

      {editing && (
        <InteractionFormDialog
          title="Edit Interaction"
          submitLabel="Save"
          initial={{
            kind: editing.kind,
            occurredAt: toCalendarDateString(editing.occurredAt),
            summary: editing.summary,
            notes: editing.notes ?? "",
          }}
          onClose={() => setEditing(null)}
          onSubmit={async (values) => {
            const result = await updateInteraction(editing.id, values);
            if (result.error) return result;
            toast.success("Interaction updated");
            setEditing(null);
            router.refresh();
          }}
        />
      )}
      <ConfirmDialog />
    </div>
  );
}

interface InteractionFormValues {
  kind: string;
  occurredAt: string;
  summary: string;
  notes: string;
}

/**
 * Shared log/edit dialog. Controlled fields (the actions take plain
 * objects, not FormData — same pattern as ContactFormDialog); the
 * caller owns the submit and closes / refreshes on success.
 */
function InteractionFormDialog({
  title,
  submitLabel,
  initial,
  onClose,
  onSubmit,
}: {
  title: string;
  submitLabel: string;
  initial?: InteractionFormValues;
  onClose: () => void;
  onSubmit: (values: InteractionFormValues) => Promise<{
    error?: string;
    fieldErrors?: Record<string, string[]>;
  } | void>;
}) {
  const [kind, setKind] = useState(initial?.kind ?? "CALL");
  const [occurredAt, setOccurredAt] = useState(
    initial?.occurredAt ?? toCalendarDateString(new Date())
  );
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [isPending, startTransition] = useTransition();

  function handleSubmit() {
    startTransition(async () => {
      const result = await onSubmit({ kind, occurredAt, summary, notes });
      if (result?.error) {
        setFieldErrors(result.fieldErrors ?? {});
        if (!result.fieldErrors) toast.error(result.error);
      }
      // On success the caller closes / refreshes.
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isPending || !summary.trim()}>
            {isPending ? "Saving…" : submitLabel}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select
            label="Kind"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            options={INTERACTION_KINDS.map((k) => ({
              value: k,
              label: INTERACTION_KIND_LABELS[k],
            }))}
          />
          <Input
            label="Date"
            type="date"
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
            error={fieldErrors.occurredAt?.[0]}
          />
        </div>
        <Input
          label="Summary"
          required
          placeholder='One line — e.g. "Intro call about the Q4 tender"'
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          error={fieldErrors.summary?.[0]}
          autoFocus
        />
        <Textarea
          label="Notes"
          placeholder="Optional details — who said what, follow-ups, links"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          error={fieldErrors.notes?.[0]}
        />
      </div>
    </Dialog>
  );
}
