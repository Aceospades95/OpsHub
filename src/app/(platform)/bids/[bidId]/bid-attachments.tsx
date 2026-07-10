"use client";

import { EntityFileSection, type EntityFile } from "@/components/shared/entity-file-section";
import { uploadBidAttachment, deleteBidAttachment } from "@/actions/bids";
import { Paperclip } from "lucide-react";

/**
 * Bid attachments — RFP PDFs, submitted responses, award letters.
 * Thin binding over the shared file section (private files, category
 * "attachment", served via /api/files/{id} with bids-module authz).
 */
export function BidAttachments({
  bidId,
  files,
  canUpload,
  canDelete,
  currentUserId,
}: {
  bidId: string;
  files: EntityFile[];
  canUpload: boolean;
  canDelete: boolean;
  currentUserId: string;
}) {
  return (
    <EntityFileSection
      files={files}
      parentField="bidId"
      parentId={bidId}
      canUpload={canUpload}
      canDelete={canDelete}
      currentUserId={currentUserId}
      actions={{ upload: uploadBidAttachment, remove: deleteBidAttachment }}
      icon={Paperclip}
      uploadLabel="Attach File"
      emptyText="Nothing attached — drop the RFP and your submitted response here."
      accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx"
    />
  );
}
