"use client";

import { useState, useTransition, useRef } from "react";
import { Upload } from "lucide-react";

import { finalizeWorkflowPortalDocument } from "@/actions/workflow-portal";
import type { PendingItem } from "./portal-client";

interface Props {
  token: string;
  item: PendingItem;
  onComplete: () => void;
  onCancel: () => void;
}

/**
 * Document upload — two-step flow:
 *
 *   1. POST the file to /api/public/portal/[token]/upload, which lands
 *      the bytes via the storage layer and returns a fileId.
 *   2. Call finalizeWorkflowPortalDocument(token, stepId, fileId) which
 *      creates the WorkflowDocument row and flips the workflow step
 *      to COMPLETED.
 *
 * Splitting the two avoids a giant FormData server action and keeps
 * the byte-handling concern out of the workflow state machine.
 */
export function DocumentUploadCard({ token, item, onComplete, onCancel }: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const documentName = (item.config.documentName as string) ?? item.stepName;
  const description = item.config.description as string | undefined;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Pick a file first");
      return;
    }

    setProgress("Uploading…");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("instanceStepId", item.instanceStepId);
      const res = await fetch(`/api/public/portal/${token}/upload`, {
        method: "POST",
        body: fd,
      });
      const json = (await res.json()) as
        | { success: true; fileId: string }
        | { error: string };
      if (!res.ok || !("success" in json)) {
        setError(("error" in json && json.error) || "Upload failed");
        setProgress(null);
        return;
      }

      setProgress("Finalizing…");
      startTransition(async () => {
        const fin = await finalizeWorkflowPortalDocument({
          token,
          instanceStepId: item.instanceStepId,
          fileId: json.fileId,
        });
        if ("error" in fin) {
          setError(fin.error ?? "Could not finalize");
          setProgress(null);
          return;
        }
        setProgress(null);
        onComplete();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setProgress(null);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <p className="font-medium text-sm text-neutral-900">{documentName}</p>
        {description && (
          <p className="text-xs text-neutral-600 mt-1 whitespace-pre-wrap">
            {description}
          </p>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        className="block w-full text-xs file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-neutral-900 file:text-white file:cursor-pointer"
      />
      <p className="text-[11px] text-neutral-500">
        PDF, Word, Excel, image, or text file. Max 10 MB.
      </p>
      {error && <p className="text-sm text-rose-700">{error}</p>}
      {progress && <p className="text-sm text-neutral-600">{progress}</p>}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending || progress != null}
          className="px-4 py-2 rounded-md border border-neutral-300 text-sm hover:bg-neutral-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending || progress != null}
          className="px-4 py-2 rounded-md bg-neutral-900 text-white text-sm hover:bg-neutral-800 disabled:opacity-60 inline-flex items-center"
        >
          <Upload className="h-3 w-3 mr-1.5" />
          {progress ?? "Upload"}
        </button>
      </div>
    </form>
  );
}
