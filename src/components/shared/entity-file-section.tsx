"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/shared/use-confirm";
import { MAX_RECEIPT_UPLOAD_BYTES, describeMaxUpload } from "@/lib/upload-limits";
import { Upload, Trash2, Loader2, Download, type LucideIcon } from "lucide-react";

export interface EntityFile {
  id: string;
  name: string;
  /** Serving URL — /api/files/{id}. */
  url: string;
  size: number | null;
  /** ISO string — serialized server-side. */
  createdAt: string;
  uploadedByName: string | null;
  uploadedById: string;
}

type FileAction = (
  prev: unknown,
  formData: FormData
) => Promise<{ success?: boolean; error?: string }>;

function formatBytes(size: number | null): string {
  if (!size) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Upload / list / download / delete for files attached to one entity —
 * shared by supplier receipts and bid attachments (and whatever grows
 * files next). Callers bind their server actions and the hidden-field
 * name carrying the parent id. Client-side size pre-check + try/finally
 * are built in (the server-action transport rejects oversized bodies
 * before the action's friendly error could run).
 */
export function EntityFileSection({
  files,
  parentField,
  parentId,
  canUpload,
  canDelete,
  currentUserId,
  actions,
  icon: Icon,
  uploadLabel = "Upload File",
  emptyText = "No files uploaded yet.",
  accept = "image/*,application/pdf",
  deleteMessage = "The file is removed from storage. This can't be undone.",
}: {
  files: EntityFile[];
  /** Hidden-field name the upload action expects, e.g. "supplierId". */
  parentField: string;
  parentId: string;
  canUpload: boolean;
  canDelete: boolean;
  currentUserId: string;
  actions: { upload: FileAction; remove: FileAction };
  icon: LucideIcon;
  uploadLabel?: string;
  emptyText?: string;
  accept?: string;
  deleteMessage?: string;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [, startTransition] = useTransition();
  const { confirm, ConfirmDialog } = useConfirm();

  async function handleFileChosen(file: File | undefined) {
    if (!file) return;
    if (file.size >= MAX_RECEIPT_UPLOAD_BYTES) {
      toast.error(`File exceeds the ${describeMaxUpload(MAX_RECEIPT_UPLOAD_BYTES)} limit`);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setUploading(true);
    const data = new FormData();
    data.set(parentField, parentId);
    data.set("file", file);
    try {
      const result = await actions.upload(null, data);
      if (result && "error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("File uploaded");
      startTransition(() => router.refresh());
    } catch {
      toast.error("Upload failed — check the file size and try again");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleDelete(file: EntityFile) {
    const ok = await confirm({
      title: `Delete "${file.name}"?`,
      message: deleteMessage,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    const fd = new FormData();
    fd.set("fileId", file.id);
    const result = await actions.remove(null, fd);
    if (result && "error" in result && result.error) {
      toast.error(result.error);
      return;
    }
    toast.success("File deleted");
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-3">
      {files.length === 0 && <p className="text-sm text-muted-foreground">{emptyText}</p>}

      {files.map((file) => {
        const mayDelete = canDelete || (canUpload && file.uploadedById === currentUserId);
        return (
          <div
            key={file.id}
            className="flex items-center gap-3 rounded border border-border bg-muted p-3 text-sm"
          >
            <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="min-w-0 flex-1">
              <a
                href={file.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium hover:text-primary hover:underline truncate block"
              >
                {file.name}
              </a>
              <p className="text-xs text-muted-foreground">
                {[
                  new Date(file.createdAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  }),
                  formatBytes(file.size),
                  file.uploadedByName,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <a
              href={file.url}
              download={file.name}
              aria-label={`Download ${file.name}`}
              className="rounded p-1 text-muted-foreground hover:text-foreground"
            >
              <Download className="h-4 w-4" />
            </a>
            {mayDelete && (
              <button
                onClick={() => handleDelete(file)}
                aria-label={`Delete ${file.name}`}
                className="rounded p-1 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        );
      })}

      {canUpload && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept={accept}
            className="hidden"
            onChange={(e) => handleFileChosen(e.target.files?.[0])}
          />
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Upload className="h-4 w-4 mr-1" />
            )}
            {uploadLabel}
          </Button>
        </>
      )}
      <ConfirmDialog />
    </div>
  );
}
