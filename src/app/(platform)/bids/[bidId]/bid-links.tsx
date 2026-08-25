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
 * "Evidence & links" card body for the bid detail page: the ExternalLink
 * rows that back up the record (award notices, incumbent contract pages,
 * Q&A threads, …). Reuses the shared FileList for render + delete; the
 * add dialog is bid-local rather than AddContentDialog because bids take
 * links only — the Embed tab would post to an entity type Embed rows
 * can't host.
 */
export function BidLinks({
  bidId,
  links,
  canEdit,
  canDelete,
}: {
  bidId: string;
  links: { id: string; title: string; url: string; description: string | null; source: string }[];
  canEdit: boolean;
  canDelete: boolean;
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
                <input type="hidden" name="entityType" value="bid" />
                <input type="hidden" name="entityId" value={bidId} />
                <input type="hidden" name="source" value="manual" />
                <Input name="title" label="Title" required />
                <Input name="url" label="URL" type="url" required placeholder="https://…" />
                <Textarea
                  name="description"
                  label="What this shows"
                  rows={2}
                  placeholder="Why this link matters for the bid record"
                />
              </>
            )}
          </FormDialog>
        </>
      )}
    </div>
  );
}
