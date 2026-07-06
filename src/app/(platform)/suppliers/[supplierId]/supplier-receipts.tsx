"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/shared/use-confirm";
import { uploadSupplierReceipt, deleteSupplierReceipt } from "@/actions/suppliers";
import { Receipt, Upload, Trash2, Loader2, Download } from "lucide-react";

interface ReceiptFile {
  id: string;
  name: string;
  /** Serving URL — /api/files/{id}. */
  url: string;
  size: number | null;
  /** ISO string — serialized server-side. */
  createdAt: string;
  uploadedByName: string | null;
}

function formatBytes(size: number | null): string {
  if (!size) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Transaction receipts for a supplier — upload, list, download, delete.
 * Files land in the storage layer as private, category "receipt", and
 * are served through /api/files/{id} (per-entity authz applies).
 */
export function SupplierReceipts({
  supplierId,
  receipts,
  canUpload,
  canDelete,
  currentUserId,
  uploaderIds,
}: {
  supplierId: string;
  receipts: ReceiptFile[];
  canUpload: boolean;
  canDelete: boolean;
  currentUserId: string;
  /** fileId → uploadedById, so uploaders see delete on their own rows. */
  uploaderIds: Record<string, string>;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [, startTransition] = useTransition();
  const { confirm, ConfirmDialog } = useConfirm();

  async function handleFileChosen(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.set("supplierId", supplierId);
    fd.set("file", file);
    const result = await uploadSupplierReceipt(null, fd);
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (result && "error" in result && result.error) {
      toast.error(result.error);
      return;
    }
    toast.success("Receipt uploaded");
    startTransition(() => router.refresh());
  }

  async function handleDelete(file: ReceiptFile) {
    const ok = await confirm({
      title: `Delete receipt "${file.name}"?`,
      message: "The file is removed from storage. This can't be undone.",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    const fd = new FormData();
    fd.set("fileId", file.id);
    const result = await deleteSupplierReceipt(null, fd);
    if (result && "error" in result && result.error) {
      toast.error(result.error);
      return;
    }
    toast.success("Receipt deleted");
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-3">
      {receipts.length === 0 && (
        <p className="text-sm text-muted-foreground">No receipts uploaded yet.</p>
      )}

      {receipts.map((file) => {
        const mayDelete = canDelete || (canUpload && uploaderIds[file.id] === currentUserId);
        return (
          <div
            key={file.id}
            className="flex items-center gap-3 rounded border border-border bg-muted p-3 text-sm"
          >
            <Receipt className="h-4 w-4 text-muted-foreground shrink-0" />
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
                aria-label={`Delete receipt ${file.name}`}
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
            accept="image/*,application/pdf"
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
            Upload Receipt
          </Button>
        </>
      )}
      <ConfirmDialog />
    </div>
  );
}
