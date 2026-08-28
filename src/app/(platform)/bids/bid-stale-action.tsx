"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { updateBidStatusInline } from "@/actions/bids";
import { Moon, Undo2 } from "lucide-react";

/**
 * One-click stage move for the pipeline's stale housekeeping, wired to
 * the existing updateBidStatusInline action:
 *
 *   mark-stale  IDENTIFIED/PREPARING row whose due date is long past →
 *               STALE ("died quietly"). decidedAt gets stamped by the
 *               action's stage bookkeeping.
 *   revive      STALE row that turned out to be alive → back to
 *               IDENTIFIED (decidedAt cleared by the same bookkeeping).
 *
 * Rendered inside row cards that are themselves wrapped in a <Link>,
 * so the click must not bubble into the navigation.
 */
export function BidStaleAction({
  bidId,
  action,
}: {
  bidId: string;
  action: "mark-stale" | "revive";
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const target = action === "mark-stale" ? "STALE" : "IDENTIFIED";
  const label = action === "mark-stale" ? "Mark stale" : "Revive";
  const Icon = action === "mark-stale" ? Moon : Undo2;

  function run(e: React.MouseEvent) {
    // Cards are wrapped in a Link — keep the click out of navigation.
    e.preventDefault();
    e.stopPropagation();
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", bidId);
      fd.set("status", target);
      const result = await updateBidStatusInline(null, fd);
      if (result && "error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(action === "mark-stale" ? "Marked stale" : "Revived — back to Identified");
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={pending}
      title={
        action === "mark-stale"
          ? "Move to Stale — it stops counting as overdue"
          : "Move back to Identified"
      }
      className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
    >
      <Icon className="h-3 w-3" />
      {pending ? "Saving…" : label}
    </button>
  );
}
