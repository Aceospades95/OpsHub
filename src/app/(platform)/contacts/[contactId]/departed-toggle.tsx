"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setContactFormer } from "@/actions/contacts";

/**
 * Prominent "Mark as departed" toggle on the contact detail page.
 * Departed contacts keep their history and links (their notes often
 * record where the old mailbox redirects) but drop out of pickers and
 * copy lists. Dedicated action — not the full-replace updateContact.
 */
export function DepartedToggle({
  contactId,
  isFormer,
}: {
  contactId: string;
  isFormer: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleToggle(next: boolean) {
    startTransition(async () => {
      const result = await setContactFormer(contactId, next);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success(next ? "Marked as departed" : "Marked as active again");
      router.refresh();
    });
  }

  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm">
      <input
        type="checkbox"
        checked={isFormer}
        disabled={isPending}
        onChange={(e) => handleToggle(e.target.checked)}
        className="mt-0.5 rounded"
      />
      <span>
        <span className="block font-medium">Mark as departed</span>
        <span className="block text-xs text-muted-foreground">
          Keeps history; drops them from pickers and copy lists.
        </span>
      </span>
    </label>
  );
}
