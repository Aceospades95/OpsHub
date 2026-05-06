"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { FormDialog } from "@/components/shared/form-dialog";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { updateDocument, deleteDocument } from "@/actions/documents";
import { Pencil, Trash2 } from "lucide-react";

interface Props {
  document: {
    id: string;
    title: string;
    content: string | null;
    type: string;
    published: boolean;
    projectId: string | null;
  };
  projectId: string;
  canEdit: boolean;
  canDelete: boolean;
}

export function DocumentActions({ document: doc, projectId, canEdit, canDelete }: Props) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  async function runDelete() {
    const fd = new FormData();
    fd.set("id", doc.id);
    return deleteDocument(null, fd);
  }

  return (
    <div className="flex gap-2">
      {canEdit && (
        <>
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4 mr-1" /> Edit
          </Button>
          <FormDialog open={editOpen} onClose={() => setEditOpen(false)} title="Edit Document" action={updateDocument}>
            {({ fieldErrors }) => (
              <>
                <input type="hidden" name="id" value={doc.id} />
                <input type="hidden" name="projectId" value={projectId} />
                <Input name="title" label="Title" defaultValue={doc.title} required error={fieldErrors?.title?.[0]} />
                <Select
                  name="type"
                  label="Type"
                  defaultValue={doc.type}
                  options={["SOP","GUIDE","POLICY","REFERENCE","TEMPLATE","OTHER"].map(t => ({ label: t, value: t }))}
                />
                <Textarea name="content" label="Content" defaultValue={doc.content || ""} className="min-h-[200px]" />
                <Input name="changelog" label="Changelog (optional)" placeholder="Describe what changed" />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="published" value="true" defaultChecked={doc.published} className="rounded" />
                  Published
                </label>
              </>
            )}
          </FormDialog>
        </>
      )}
      {canDelete && (
        <>
          <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-4 w-4 mr-1" /> Delete
          </Button>
          <ConfirmDialog
            open={deleteOpen}
            onClose={() => setDeleteOpen(false)}
            title="Delete Document"
            message={<>Delete <strong>{doc.title}</strong>?</>}
            onConfirm={runDelete}
            navigateTo={`/projects/${projectId}`}
            confirmLabel="Delete"
          />
        </>
      )}
    </div>
  );
}
