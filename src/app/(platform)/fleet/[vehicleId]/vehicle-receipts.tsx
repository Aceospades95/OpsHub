"use client";

import { EntityFileSection, type EntityFile } from "@/components/shared/entity-file-section";
import { uploadVehicleReceipt, deleteVehicleReceipt } from "@/actions/fleet";
import { Receipt } from "lucide-react";

/**
 * Maintenance receipts / photos / registration docs for a vehicle —
 * thin binding over the shared file section (the supplier-receipts
 * pattern). Private storage, category "receipt"; assigned drivers can
 * upload for their own vehicle (that's the maintenance-submission
 * workflow), fleet perms govern everyone else.
 */
export function VehicleReceipts({
  vehicleId,
  receipts,
  canUpload,
  canDelete,
  currentUserId,
}: {
  vehicleId: string;
  receipts: EntityFile[];
  canUpload: boolean;
  canDelete: boolean;
  currentUserId: string;
}) {
  return (
    <EntityFileSection
      files={receipts}
      parentField="vehicleId"
      parentId={vehicleId}
      canUpload={canUpload}
      canDelete={canDelete}
      currentUserId={currentUserId}
      actions={{ upload: uploadVehicleReceipt, remove: deleteVehicleReceipt }}
      icon={Receipt}
      uploadLabel="Upload receipt / photo"
      emptyText="No receipts or documents yet — attach maintenance receipts, photos, or registration paperwork."
    />
  );
}
