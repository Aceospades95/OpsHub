"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { AddContentDialog } from "@/components/shared/add-content-dialog";
import { FileList } from "@/components/shared/file-list";
import { Plus } from "lucide-react";

interface Props {
  embeds: { id: string; title: string; embedUrl: string; embedType: string; description: string | null; width: string | null; height: string | null }[];
  toolId: string;
  canEdit: boolean;
  canDelete: boolean;
}

export function ToolEmbedsSection({ embeds, toolId, canEdit, canDelete }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-3">
      <FileList embeds={embeds} canDelete={canDelete} />
      {canEdit && (
        <>
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Add Embed
          </Button>
          <AddContentDialog open={open} onClose={() => setOpen(false)} entityType="tool" entityId={toolId} />
        </>
      )}
    </div>
  );
}
