"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormDialog } from "@/components/shared/form-dialog";
import { FileList } from "@/components/shared/file-list";
import { addExternalLink } from "@/actions/attachments";
import { Plus } from "lucide-react";

/**
 * "Evidence & links" card body for entities that take ExternalLink rows
 * but not Embeds (bids, clients): award notices, the Gmail thread or
 * Drive folder a record's facts came from, incumbent contract pages.
 * Reuses the shared FileList for render + delete; the add dialog is
 * local rather than AddContentDialog because the Embed tab would post
 * to an entity type Embed rows can't host.
 *
 * Grew out of the bid-detail card (bid-links.tsx) — generalized when
 * clients gained ExternalLink support so both pages share one dialog.
 */
export function EvidenceLinks({
  entityType,
  entityId,
  links,
  canEdit,
  canDelete,
  addDescriptionPlaceholder = "Why this link matters for this record",
}: {
  entityType: "bid" | "client";
  entityId: string;
  links: { id: string; title: string; url: string; description: string | null; source: string }[];
  canEdit: boolean;
  canDelete: boolean;
  addDescriptionPlaceholder?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-3">
      <FileList links={links} canDelete={canDelete} emptyLabel="No links yet" />
      {canEdit && (
        <>
          <Button variant="outline" size="sm" className="w-full" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Add link
          </Button>
          <FormDialog
            open={open}
            onClose={() => setOpen(false)}
            title="Add evidence link"
            action={addExternalLink}
            submitLabel="Add link"
          >
            {() => (
              <>
                <input type="hidden" name="entityType" value={entityType} />
                <input type="hidden" name="entityId" value={entityId} />
                <input type="hidden" name="source" value="manual" />
                <Input name="title" label="Title" required />
                <Input name="url" label="URL" type="url" required placeholder="https://…" />
                <Textarea
                  name="description"
                  label="What this shows"
                  rows={2}
                  placeholder={addDescriptionPlaceholder}
                />
              </>
            )}
          </FormDialog>
        </>
      )}
    </div>
  );
}
