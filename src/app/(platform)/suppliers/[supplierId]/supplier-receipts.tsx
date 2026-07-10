"use client";

import { EntityFileSection, type EntityFile } from "@/components/shared/entity-file-section";
import { uploadSupplierReceipt, deleteSupplierReceipt } from "@/actions/suppliers";
import { Receipt } from "lucide-react";

/**
 * Transaction receipts for a supplier — thin binding over the shared
 * file section. Files land in the storage layer as private, category
 * "receipt", served through /api/files/{id} (per-entity authz applies).
 */
export function SupplierReceipts({
  supplierId,
  receipts,
  canUpload,
  canDelete,
  currentUserId,
}: {
  supplierId: string;
  receipts: EntityFile[];
  canUpload: boolean;
  canDelete: boolean;
  currentUserId: string;
}) {
  return (
    <EntityFileSection
      files={receipts}
      parentField="supplierId"
      parentId={supplierId}
      canUpload={canUpload}
      canDelete={canDelete}
      currentUserId={currentUserId}
      actions={{ upload: uploadSupplierReceipt, remove: deleteSupplierReceipt }}
      icon={Receipt}
      uploadLabel="Upload Receipt"
      emptyText="No receipts uploaded yet."
    />
  );
}
