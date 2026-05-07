"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { RotateCcw, Trash2 } from "lucide-react";

import { restoreEntity, permanentlyDeleteEntity } from "@/actions/recovery";

interface Props {
  entityType: string;
  id: string;
  label: string;
  singularLabel: string;
}

/**
 * Per-row actions on /admin/recovery: Restore + Delete forever.
 * Confirms the destructive Delete forever via window.confirm so an
 * accidental click on the wrong row doesn't bypass the recovery
 * window — that's the whole point of soft-delete in the first place.
 */
export function RecoveryRowActions({
  entityType,
  id,
  label,
  singularLabel,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleRestore() {
    setError(null);
    startTransition(async () => {
      const result = await restoreEntity({ entityType, id });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function handlePermanent() {
    setError(null);
    if (
      !window.confirm(
        `Permanently delete ${singularLabel} "${label}"?\n\nThis can't be undone — it skips the 30-day recovery window.`
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await permanentlyDeleteEntity({ entityType, id });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={handleRestore}
        disabled={pending}
      >
        <RotateCcw className="h-3 w-3 mr-1" />
        Restore
      </Button>
      <Button
        size="sm"
        variant="destructive"
        onClick={handlePermanent}
        disabled={pending}
        title="Skip the 30-day window and hard-delete now"
      >
        <Trash2 className="h-3 w-3 mr-1" />
        Delete forever
      </Button>
      {error && <span className="text-xs text-destructive ml-2">{error}</span>}
    </div>
  );
}
