"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  updateProjectStatusInline,
  updateProjectNotesInline,
  updateProjectOwnerInline,
} from "@/actions/projects";
import { Search, Table2, Check } from "lucide-react";

export interface OverviewRow {
  id: string;
  name: string;
  href: string;
  clientName: string;
  clientId: string;
  status: string;
  ownerId: string | null;
  ownerName: string | null;
  notes: string | null;
  openTasks: number;
  /** ISO string — serialized server-side. */
  updatedAt: string;
}

const STATUS_OPTIONS = [
  { value: "PLANNING", label: "Planning" },
  { value: "ACTIVE", label: "Active" },
  { value: "ON_HOLD", label: "On hold" },
  { value: "COMPLETED", label: "Completed" },
  { value: "ARCHIVED", label: "Archived" },
];

/** Statuses shown by default — completed/archived are opt-in noise. */
const DEFAULT_VISIBLE = new Set(["PLANNING", "ACTIVE", "ON_HOLD"]);

/**
 * The spreadsheet replacement: one row per project, status and notes
 * editable in place, no drill-in required. Server actions save each cell
 * individually; the row flashes a check on success.
 */
export function MyProjectsOverview({
  rows,
  canEdit,
  owners,
  canAssignOwner,
  currentUserId,
}: {
  rows: OverviewRow[];
  canEdit: boolean;
  owners: { id: string; name: string }[];
  canAssignOwner: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [mineOnly, setMineOnly] = useState(false);
  // Local overrides so edits render instantly; router.refresh() reconciles.
  const [statusOverride, setStatusOverride] = useState<Record<string, string>>({});
  const [notesOverride, setNotesOverride] = useState<Record<string, string>>({});
  const [ownerOverride, setOwnerOverride] = useState<Record<string, string>>({});
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const [editingNotes, setEditingNotes] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      const status = statusOverride[r.id] ?? r.status;
      if (!showAll && !DEFAULT_VISIBLE.has(status)) return false;
      if (mineOnly && (ownerOverride[r.id] ?? r.ownerId) !== currentUserId) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        r.clientName.toLowerCase().includes(q) ||
        (r.notes ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, query, showAll, mineOnly, statusOverride, ownerOverride, currentUserId]);

  function flashSaved(id: string) {
    setSavedFlash(id);
    setTimeout(() => setSavedFlash((cur) => (cur === id ? null : cur)), 1500);
  }

  async function saveStatus(id: string, status: string, previous: string) {
    setStatusOverride((s) => ({ ...s, [id]: status }));
    const result = await updateProjectStatusInline(id, status);
    if (result && "error" in result) {
      setStatusOverride((s) => ({ ...s, [id]: previous }));
      toast.error(result.error);
      return;
    }
    flashSaved(id);
    startTransition(() => router.refresh());
  }

  async function saveNotes(id: string, notes: string, previous: string) {
    setEditingNotes(null);
    if (notes === previous) return;
    setNotesOverride((s) => ({ ...s, [id]: notes }));
    const result = await updateProjectNotesInline(id, notes);
    if (result && "error" in result) {
      setNotesOverride((s) => ({ ...s, [id]: previous }));
      toast.error(result.error);
      return;
    }
    flashSaved(id);
    startTransition(() => router.refresh());
  }

  async function saveOwner(id: string, ownerId: string, previous: string) {
    setOwnerOverride((s) => ({ ...s, [id]: ownerId }));
    const result = await updateProjectOwnerInline(id, ownerId || null);
    if (result && "error" in result) {
      setOwnerOverride((s) => ({ ...s, [id]: previous }));
      toast.error(result.error);
      return;
    }
    flashSaved(id);
    startTransition(() => router.refresh());
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <CardTitle className="flex items-center gap-2">
            <Table2 className="h-4 w-4" />
            All projects ({visible.length})
          </CardTitle>
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={mineOnly}
                onChange={(e) => setMineOnly(e.target.checked)}
                className="rounded"
              />
              Mine only
            </label>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showAll}
                onChange={(e) => setShowAll(e.target.checked)}
                className="rounded"
              />
              Include completed
            </label>
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter projects…"
                className="pl-8 pr-3 py-1.5 text-sm border border-input rounded-md bg-background w-52"
              />
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">No projects match.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Project</th>
                  <th className="py-2 pr-3 font-medium">Client</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Owner</th>
                  <th className="py-2 pr-3 font-medium w-[38%]">Notes</th>
                  <th className="py-2 font-medium text-right">Open tasks</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const status = statusOverride[r.id] ?? r.status;
                  const notes = notesOverride[r.id] ?? r.notes ?? "";
                  const ownerId = ownerOverride[r.id] ?? r.ownerId ?? "";
                  const ownerName =
                    ownerOverride[r.id] !== undefined
                      ? owners.find((o) => o.id === ownerOverride[r.id])?.name ?? null
                      : r.ownerName;
                  return (
                    <tr key={r.id} className="border-b border-border align-top">
                      <td className="py-2.5 pr-3">
                        <div className="flex items-center gap-1.5">
                          <Link href={r.href} className="font-medium hover:text-primary hover:underline">
                            {r.name}
                          </Link>
                          {savedFlash === r.id && (
                            <Check className="h-3.5 w-3.5 text-success shrink-0" aria-label="Saved" />
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 pr-3 text-muted-foreground">
                        <Link href={`/clients/${r.clientId}`} className="hover:text-primary hover:underline">
                          {r.clientName}
                        </Link>
                      </td>
                      <td className="py-2.5 pr-3">
                        {canEdit ? (
                          <select
                            value={status}
                            onChange={(e) => saveStatus(r.id, e.target.value, status)}
                            className="px-2 py-1 text-xs border border-input rounded-md bg-background"
                            aria-label={`Status for ${r.name}`}
                          >
                            {STATUS_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <StatusBadge status={status} />
                        )}
                      </td>
                      <td className="py-2.5 pr-3">
                        {canAssignOwner ? (
                          <select
                            value={ownerId}
                            onChange={(e) => saveOwner(r.id, e.target.value, ownerId)}
                            className="px-2 py-1 text-xs border border-input rounded-md bg-background max-w-[10rem]"
                            aria-label={`Owner for ${r.name}`}
                          >
                            <option value="">Unassigned</option>
                            {owners.map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-muted-foreground text-xs">
                            {ownerName ?? "—"}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3">
                        {canEdit ? (
                          editingNotes === r.id ? (
                            <textarea
                              defaultValue={notes}
                              autoFocus
                              rows={3}
                              maxLength={5000}
                              onBlur={(e) => saveNotes(r.id, e.target.value.trim(), notes)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                                  e.currentTarget.blur();
                                }
                                if (e.key === "Escape") {
                                  setEditingNotes(null);
                                }
                              }}
                              className="w-full px-2 py-1 text-xs border border-input rounded-md bg-background resize-y"
                              aria-label={`Notes for ${r.name}`}
                            />
                          ) : (
                            <button
                              type="button"
                              onClick={() => setEditingNotes(r.id)}
                              className="w-full text-left text-xs whitespace-pre-wrap rounded px-2 py-1 -mx-2 hover:bg-muted transition-colors min-h-[1.75rem]"
                            >
                              {notes ? (
                                <span>{notes}</span>
                              ) : (
                                <span className="text-muted-foreground italic">Add a note…</span>
                              )}
                            </button>
                          )
                        ) : (
                          <span className="text-xs whitespace-pre-wrap text-muted-foreground">
                            {notes || "—"}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 text-right tabular-nums">
                        {r.openTasks > 0 ? (
                          <Link
                            href={`/tasks?project=${r.id}`}
                            className="hover:text-primary hover:underline"
                          >
                            {r.openTasks}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
