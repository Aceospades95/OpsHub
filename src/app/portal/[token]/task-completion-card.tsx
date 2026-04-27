"use client";

import { useState, useTransition } from "react";
import { Check } from "lucide-react";

import { completeWorkflowPortalTaskStep } from "@/actions/workflow-portal";
import type { PendingItem } from "./portal-client";

interface Props {
  token: string;
  item: PendingItem;
  onComplete: () => void;
  onCancel: () => void;
}

/**
 * Render the task description and let the subject mark it done. Tasks
 * have no "input" — they're just acknowledgements ("I read the
 * handbook", "I joined the Slack channel"). On confirm we mark both
 * the workflow step AND the linked Task row complete so the existing
 * /tasks UI reflects the change.
 */
export function TaskCompletionCard({ token, item, onComplete, onCancel }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const description = item.config.description as string | undefined;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await completeWorkflowPortalTaskStep({
        token,
        instanceStepId: item.instanceStepId,
      });
      if ("error" in res) {
        setError(res.error ?? "Could not complete");
        return;
      }
      onComplete();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {description && (
        <p className="text-sm text-neutral-700 whitespace-pre-wrap">
          {description}
        </p>
      )}
      {!description && (
        <p className="text-sm text-neutral-500">
          When you&apos;re done, click the button below to mark this task
          complete.
        </p>
      )}
      {error && <p className="text-sm text-rose-700">{error}</p>}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="px-4 py-2 rounded-md border border-neutral-300 text-sm hover:bg-neutral-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="px-4 py-2 rounded-md bg-emerald-600 text-white text-sm hover:bg-emerald-700 disabled:opacity-60 inline-flex items-center"
        >
          <Check className="h-3 w-3 mr-1.5" />
          {pending ? "Saving…" : "Mark complete"}
        </button>
      </div>
    </form>
  );
}
