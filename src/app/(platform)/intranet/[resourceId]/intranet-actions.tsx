"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { FormDialog } from "@/components/shared/form-dialog";
import { Dialog } from "@/components/ui/dialog";
import { updateIntranetResource, deleteIntranetResource } from "@/actions/intranet";
import { Pencil, Trash2 } from "lucide-react";

interface Props {
  resource: {
    id: string; title: string; description: string | null; content: string | null;
    category: string; published: boolean; pinned: boolean; sortOrder: number;
  };
  canEdit: boolean;
  canDelete: boolean;
}

export function IntranetActions({ resource, canEdit, canDelete }: Props) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const router = useRouter();

  async function handleDelete() {
    const fd = new FormData();
    fd.set("id", resource.id);
    const result = await deleteIntranetResource(null, fd);
    if (result.success) router.push("/intranet");
  }

  return (
    <div className="flex gap-2">
      {canEdit && (
        <>
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}><Pencil className="h-4 w-4 mr-1" /> Edit</Button>
          <FormDialog open={editOpen} onClose={() => setEditOpen(false)} title="Edit Resource" action={updateIntranetResource}>
            {({ fieldErrors }) => (
              <>
                <input type="hidden" name="id" value={resource.id} />
                <Input name="title" label="Title" defaultValue={resource.title} required error={fieldErrors?.title?.[0]} />
                <Select name="category" label="Category" defaultValue={resource.category}
                  options={["EXPENSE_REPORT","TIME_OFF","ORG_CHART","ANNOUNCEMENT","HR_POLICY","SOP","GENERAL_RESOURCE","FORM","OTHER"].map(c => ({ label: c.replace(/_/g," "), value: c }))}
                />
                <Textarea name="description" label="Description" defaultValue={resource.description || ""} />
                <Textarea name="content" label="Content" defaultValue={resource.content || ""} className="min-h-[150px]" />
                <Input name="sortOrder" label="Sort Order" type="number" defaultValue={resource.sortOrder.toString()} />
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="published" value="true" defaultChecked={resource.published} className="rounded" />
                    Published
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="pinned" value="true" defaultChecked={resource.pinned} className="rounded" />
                    Pinned
                  </label>
                </div>
              </>
            )}
          </FormDialog>
        </>
      )}
      {canDelete && (
        <>
          <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}><Trash2 className="h-4 w-4 mr-1" /> Delete</Button>
          <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete Resource">
            <p className="text-sm text-muted-foreground mb-4">Delete <strong>{resource.title}</strong>?</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
              <Button variant="destructive" onClick={handleDelete}>Delete</Button>
            </div>
          </Dialog>
        </>
      )}
    </div>
  );
}
