"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { AddContentDialog } from "@/components/shared/add-content-dialog";
import { FileList } from "@/components/shared/file-list";
import { Plus } from "lucide-react";

interface Props {
  supplierId: string;
  links: { id: string; title: string; url: string; description: string | null; source: string }[];
  canEdit: boolean;
  canDelete: boolean;
}

export function SupplierAttachments({ supplierId, links, canEdit, canDelete }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-3">
      <FileList links={links} canDelete={canDelete} />
      {canEdit && (
        <>
          <Button variant="outline" size="sm" className="w-full" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Add Content
          </Button>
          <AddContentDialog open={open} onClose={() => setOpen(false)} entityType="supplier" entityId={supplierId} />
        </>
      )}
    </div>
  );
}
