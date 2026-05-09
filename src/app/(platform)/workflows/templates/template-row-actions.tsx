"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { useConfirm } from "@/components/shared/use-confirm";
import {
  setWorkflowTemplateActive,
  deleteWorkflowTemplate,
} from "@/actions/workflow-templates";

interface Props {
  templateId: string;
  /** Current active state — controls which button (Archive vs Restore)
   *  the row exposes. */
  isActive: boolean;
  /** True for system-seeded templates. The Delete button is hidden
   *  entirely on those — the action refuses on the server too, but
   *  surfacing a button just to immediately error is bad UX. */
  isSeed: boolean;
  /** Whether the caller may edit (controls archive/restore visibility). */
  canEdit: boolean;
  /** Whether the caller may delete (controls Delete visibility — the
   *  server still enforces; this is just to hide the button for VIEWER
   *  callers who'd hit a permission denied otherwise). */
  canDelete: boolean;
}

/**
 * Per-row action cluster shown on /workflows/templates. Three buttons,
 * surfaced based on state:
 *
 *   - Active template:   Archive
 *   - Archived template: Restore + Delete (delete only when canDelete
 *                        and no running instances)
 *
 * Archive shows a real toast (sonner, mounted at the platform shell)
 * with an Undo action for ~6s. Round-9 QA: the previous inline span
 * lived in the row at text-[10px] muted color and was practically
 * invisible.
 */
export function WorkflowTemplateRowActions({
  templateId,
  isActive,
  isSeed,
  canEdit,
  canDelete,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { confirm, ConfirmDialog } = useConfirm();

  function handleArchiveToggle() {
    setError(null);
    startTransition(async () => {
      const r = await setWorkflowTemplateActive(templateId, !isActive);
      if ("error" in r && r.error) {
        setError(r.error);
        return;
      }
      // Only surface undo on the archive direction; restore is
      // already user-initiated cleanup so a toast adds noise.
      if (isActive) {
        toast.success("Workflow template archived", {
          action: {
            label: "Undo",
            onClick: () => {
              startTransition(async () => {
                const restore = await setWorkflowTemplateActive(templateId, true);
                if ("error" in restore && restore.error) {
                  toast.error(restore.error);
                  return;
                }
                toast.success("Restored");
                router.refresh();
              });
            },
          },
        });
      }
      router.refresh();
    });
  }

  async function handleDelete() {
    setError(null);
    const ok = await confirm({
      title: "Permanently delete this template?",
      message: "This can't be undone.",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    startTransition(async () => {
      const r = await deleteWorkflowTemplate(templateId);
      if ("error" in r && r.error) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        {canEdit && (
          isActive ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={handleArchiveToggle}
              disabled={isPending}
              className="h-7 px-2 text-xs"
              title="Archive this template — stops new instances from spawning, keeps history"
            >
              <Archive className="h-3.5 w-3.5 mr-1" />
              Archive
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={handleArchiveToggle}
              disabled={isPending}
              className="h-7 px-2 text-xs"
              title="Restore this template — new instances can spawn from it again"
            >
              <ArchiveRestore className="h-3.5 w-3.5 mr-1" />
              Restore
            </Button>
          )
        )}
        {canDelete && !isSeed && !isActive && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={handleDelete}
            disabled={isPending}
            className="h-7 px-2 text-xs text-destructive hover:text-destructive"
            title="Permanently delete. Refused if any instance has ever run from this template."
          >
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            Delete
          </Button>
        )}
      </div>
      {error && (
        <span className="text-[10px] text-destructive max-w-[260px] text-right">
          {error}
        </span>
      )}
      <ConfirmDialog />
    </div>
  );
}
