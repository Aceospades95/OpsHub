"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { AddContentDialog } from "@/components/shared/add-content-dialog";
import { FileList } from "@/components/shared/file-list";
import { Plus } from "lucide-react";

interface Props {
  projectId: string;
  links: { id: string; title: string; url: string; description: string | null; source: string }[];
  embeds: { id: string; title: string; embedUrl: string; embedType: string; description: string | null; width: string | null; height: string | null }[];
  canEdit: boolean;
  canDelete: boolean;
}

export function ProjectAttachments({ projectId, links, embeds, canEdit, canDelete }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-3">
      <FileList links={links} embeds={embeds} canDelete={canDelete} />
      {canEdit && (
        <>
          <Button variant="outline" size="sm" className="w-full" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Add Content
          </Button>
          <AddContentDialog
            open={open}
            onClose={() => setOpen(false)}
            entityType="project"
            entityId={projectId}
          />
        </>
      )}
    </div>
  );
}
