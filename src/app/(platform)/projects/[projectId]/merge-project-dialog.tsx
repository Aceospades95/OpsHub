"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { GitMerge } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useConfirm } from "@/components/shared/use-confirm";
import { formatCalendarDate } from "@/lib/dates";
import {
  getMergeCandidates,
  mergeProjects,
  type MergeCandidate,
  type ProjectMergePreviewItem,
} from "@/actions/merge-projects";

/**
 * Admin-only "Merge a duplicate into this project" flow. The page's
 * project is always the KEEPER; the picked sibling is merged away
 * (children repointed, then soft-deleted — recoverable from the bin).
 *
 * Exists because imports minted 22 exact-twin projects; hand-deleting
 * them would silently orphan whichever children hang off the twin.
 * Candidates load lazily on open, the preview is a server dry-run, and
 * nothing mutates until the styled confirm.
 */

interface Props {
  projectId: string;
  projectName: string;
}

export function MergeProjectDialog({ projectId, projectName }: Props) {
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<MergeCandidate[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    from: ProjectMergePreviewItem;
    to: ProjectMergePreviewItem;
  } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewPending, startPreview] = useTransition();
  const [commitPending, startCommit] = useTransition();
  const { confirm, ConfirmDialog } = useConfirm();
  const router = useRouter();

  // Lazy-load the same-client sibling list each time the dialog opens —
  // the page itself never pays for it, and a reopen sees fresh data.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setCandidates(null);
    setLoadError(null);
    getMergeCandidates(projectId)
      .then((res) => {
        if (cancelled) return;
        if (res.ok) setCandidates(res.candidates);
        else setLoadError(res.error);
      })
      .catch(() => {
        if (!cancelled) setLoadError("Failed to load projects (see console)");
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  const filtered = useMemo(() => {
    if (!candidates) return [];
    const q = search.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((c) => c.name.toLowerCase().includes(q));
  }, [candidates, search]);

  function handleClose() {
    if (commitPending) return;
    setOpen(false);
    setSearch("");
    setSelectedId(null);
    setPreview(null);
    setPreviewError(null);
  }

  function pick(id: string) {
    setSelectedId(id);
    setPreview(null);
    setPreviewError(null);
    startPreview(async () => {
      const res = await mergeProjects({ fromId: id, toId: projectId, dryRun: true });
      if (res.ok && res.preview) setPreview(res.preview);
      else setPreviewError(res.error ?? "Preview failed");
    });
  }

  async function handleMerge() {
    if (!preview) return;
    const moving = preview.from.attachmentCount;
    const ok = await confirm({
      title: "Merge projects",
      message: `Merge "${preview.from.name}" into "${preview.to.name}"? Its ${moving} attached record${moving === 1 ? "" : "s"} move${moving === 1 ? "s" : ""} here and the duplicate goes to the recovery bin.`,
      confirmLabel: "Merge",
      variant: "destructive",
    });
    if (!ok) return;
    startCommit(async () => {
      const res = await mergeProjects({
        fromId: preview.from.id,
        toId: projectId,
        dryRun: false,
      });
      if (res.ok) {
        toast.success(`Merged "${preview.from.name}" into this project`);
        handleClose();
        router.refresh();
      } else {
        setPreviewError(res.error ?? "Merge failed");
      }
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <GitMerge className="h-4 w-4 mr-1" /> Merge duplicate
      </Button>
      <Dialog
        open={open}
        onClose={handleClose}
        title="Merge a duplicate into this project"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={handleClose} disabled={commitPending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleMerge}
              disabled={!preview || previewPending || commitPending}
            >
              {commitPending ? "Merging…" : "Merge into this project"}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Pick the duplicate to merge away. Everything attached to it —
            contracts, tasks, files, bids, people — moves onto{" "}
            <strong>{projectName}</strong>, and the duplicate itself goes to
            the recovery bin.
          </p>

          {loadError && <p className="text-sm text-destructive">{loadError}</p>}
          {!candidates && !loadError && (
            <p className="text-sm text-muted-foreground">Loading projects…</p>
          )}

          {candidates && candidates.length === 0 && (
            <p className="text-sm text-muted-foreground">
              This client has no other projects — nothing to merge.
            </p>
          )}

          {candidates && candidates.length > 0 && (
            <>
              <Input
                label="Filter"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Type to filter project names…"
              />
              <div
                role="radiogroup"
                aria-label="Project to merge away"
                className="max-h-48 overflow-y-auto rounded border border-input divide-y divide-border"
              >
                {filtered.map((c) => (
                  <label
                    key={c.id}
                    className="flex items-center gap-2 px-2.5 py-2 text-sm hover:bg-muted cursor-pointer"
                  >
                    <input
                      type="radio"
                      name="merge-source"
                      checked={selectedId === c.id}
                      onChange={() => pick(c.id)}
                      className="border-input"
                    />
                    <span className="truncate flex-1">{c.name}</span>
                    {c.likelyDuplicate && (
                      <Badge variant="warning">same name</Badge>
                    )}
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      created {formatCalendarDate(c.createdAt, "MMM d, yyyy")}
                    </span>
                  </label>
                ))}
                {filtered.length === 0 && (
                  <p className="px-2.5 py-2 text-sm text-muted-foreground">
                    No projects match the filter.
                  </p>
                )}
              </div>
            </>
          )}

          {previewPending && (
            <p className="text-sm text-muted-foreground">Checking what would move…</p>
          )}
          {previewError && <p className="text-sm text-destructive">{previewError}</p>}

          {preview && !previewPending && (
            <div className="rounded border border-border bg-muted/40 p-3 text-sm space-y-2">
              <p className="font-medium">
                Merging &ldquo;{preview.from.name}&rdquo; (created{" "}
                {formatCalendarDate(preview.from.createdAt, "MMM d, yyyy")}) into
                &ldquo;{preview.to.name}&rdquo; (created{" "}
                {formatCalendarDate(preview.to.createdAt, "MMM d, yyyy")})
              </p>
              {preview.from.attachmentCount === 0 ? (
                <p className="text-muted-foreground">
                  Nothing is attached to the duplicate — it will simply be
                  moved to the recovery bin.
                </p>
              ) : (
                <>
                  <p className="text-muted-foreground">
                    Moves onto this project:
                  </p>
                  <ul className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                    {Object.entries(preview.from.breakdown).map(([label, n]) => (
                      <li key={label} className="text-muted-foreground">
                        {label}: <span className="text-foreground">{n}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <p className="text-xs text-muted-foreground">
                Blank fields on this project (dates, description, owner,
                offering) are filled from the duplicate where it has values.
              </p>
            </div>
          )}
        </div>
      </Dialog>
      <ConfirmDialog />
    </>
  );
}
