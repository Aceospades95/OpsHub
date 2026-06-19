"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/shared/status-badge";
import { useConfirm } from "@/components/shared/use-confirm";
import { linkRelatedProject, unlinkRelatedProject } from "@/actions/projects";
import { Plus, X, GitBranch } from "lucide-react";

interface RelatedProject {
  id: string;
  name: string;
  status: string;
}

interface Props {
  projectId: string;
  /** Projects this one references / supports (outgoing links). */
  related: RelatedProject[];
  /** Projects that reference this one (incoming links). */
  referencedBy: RelatedProject[];
  /** All other projects available to link (already-linked + self removed). */
  availableProjects: { id: string; name: string }[];
  canEdit: boolean;
}

export function ProjectRelationsCard({
  projectId,
  related,
  referencedBy,
  availableProjects,
  canEdit,
}: Props) {
  const [selectedId, setSelectedId] = useState("");
  const [isPending, startTransition] = useTransition();
  const { confirm, ConfirmDialog } = useConfirm();
  const router = useRouter();

  function handleLink() {
    if (!selectedId) return;
    startTransition(async () => {
      const result = await linkRelatedProject(projectId, selectedId);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Project linked");
      setSelectedId("");
      router.refresh();
    });
  }

  function handleUnlink(otherId: string, name: string) {
    startTransition(async () => {
      const ok = await confirm({
        title: "Remove this link?",
        message: `The relationship with "${name}" will be removed. Neither project is deleted.`,
        confirmLabel: "Remove",
      });
      if (!ok) return;
      const result = await unlinkRelatedProject(projectId, otherId);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Link removed");
      router.refresh();
    });
  }

  function row(p: RelatedProject, removable: boolean) {
    return (
      <div
        key={p.id}
        className="flex items-center justify-between gap-2 rounded border border-border bg-muted p-3"
      >
        <Link
          href={`/projects/${p.id}`}
          className="min-w-0 flex-1 hover:text-primary transition-colors"
        >
          <p className="text-sm font-medium truncate">{p.name}</p>
        </Link>
        <StatusBadge status={p.status} />
        {canEdit && removable && (
          <button
            type="button"
            onClick={() => handleUnlink(p.id, p.name)}
            disabled={isPending}
            aria-label={`Remove link to ${p.name}`}
            className="rounded p-1 text-muted-foreground hover:text-destructive disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {related.length === 0 && referencedBy.length === 0 && (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <GitBranch className="h-4 w-4" /> No related projects
          </p>
        )}

        {related.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Supports / references
            </p>
            {related.map((p) => row(p, true))}
          </div>
        )}

        {referencedBy.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Referenced by
            </p>
            {/* These links are owned by the other project but can be
                removed from either end — the action resolves the row. */}
            {referencedBy.map((p) => row(p, true))}
          </div>
        )}
      </div>

      {canEdit && availableProjects.length > 0 && (
        <div className="flex items-end gap-2 border-t border-border pt-3">
          <div className="flex-1">
            <Select
              label="Link a related project"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              placeholder="Choose a project…"
              options={availableProjects.map((p) => ({
                value: p.id,
                label: p.name,
              }))}
            />
          </div>
          <Button
            type="button"
            size="sm"
            onClick={handleLink}
            disabled={!selectedId || isPending}
          >
            <Plus className="h-4 w-4 mr-1" /> Link
          </Button>
        </div>
      )}

      <ConfirmDialog />
    </div>
  );
}
