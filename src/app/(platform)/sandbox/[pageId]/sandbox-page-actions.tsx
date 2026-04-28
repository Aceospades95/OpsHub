"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFormState } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { FormDialog } from "@/components/shared/form-dialog";
import { Dialog } from "@/components/ui/dialog";
import { updateSandboxPage, deleteSandboxPage, toggleSandboxPublished } from "@/actions/sandbox";
import { Pencil, Trash2, Eye, EyeOff } from "lucide-react";
import { IconPicker } from "@/components/ui/icon-picker";

interface Props {
  page: {
    id: string;
    title: string;
    slug: string;
    description: string | null;
    content: string | null;
    layout: string;
    icon: string | null;
    published: boolean;
    projectId: string | null;
    clientId: string | null;
  };
  canEdit: boolean;
  canDelete: boolean;
  isAdmin: boolean;
  projects: { id: string; name: string }[];
  clients: { id: string; name: string }[];
}

export function SandboxPageActions({ page, canEdit, canDelete, isAdmin, projects, clients }: Props) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [publishState, publishAction] = useFormState(toggleSandboxPublished, null);
  const router = useRouter();

  async function handleDelete() {
    const fd = new FormData();
    fd.set("id", page.id);
    const result = await deleteSandboxPage(null, fd);
    if ("success" in result && result.success) router.push("/sandbox");
  }

  return (
    <div className="flex items-center gap-2">
      {isAdmin && (
        <form action={publishAction}>
          <input type="hidden" name="id" value={page.id} />
          <Button type="submit" variant="outline" size="sm">
            {page.published ? (
              <><EyeOff className="h-4 w-4 mr-1" /> Unpublish</>
            ) : (
              <><Eye className="h-4 w-4 mr-1" /> Publish</>
            )}
          </Button>
        </form>
      )}

      {canEdit && (
        <>
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4 mr-1" /> Edit
          </Button>
          <FormDialog open={editOpen} onClose={() => setEditOpen(false)} title="Edit Sandbox Page" action={updateSandboxPage}>
            {({ fieldErrors }) => (
              <>
                <input type="hidden" name="id" value={page.id} />
                <Input name="title" label="Title" defaultValue={page.title} required error={fieldErrors?.title?.[0]} />
                <Input name="slug" label="URL Slug" defaultValue={page.slug} required error={fieldErrors?.slug?.[0]} />
                <IconPicker name="icon" value={page.icon} label="Page icon" />
                <Textarea name="description" label="Description" defaultValue={page.description || ""} />
                <Textarea name="content" label="Content" defaultValue={page.content || ""} rows={8} />
                <Select
                  name="layout"
                  label="Layout"
                  defaultValue={page.layout}
                  options={[
                    { label: "Default", value: "default" },
                    { label: "Wide", value: "wide" },
                    { label: "Full Width", value: "full" },
                  ]}
                />
                <Select
                  name="projectId"
                  label="Associated Project"
                  defaultValue={page.projectId || ""}
                  options={[
                    { label: "None", value: "" },
                    ...projects.map((p) => ({ label: p.name, value: p.id })),
                  ]}
                />
                <Select
                  name="clientId"
                  label="Associated Client"
                  defaultValue={page.clientId || ""}
                  options={[
                    { label: "None", value: "" },
                    ...clients.map((c) => ({ label: c.name, value: c.id })),
                  ]}
                />
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
          <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete Sandbox Page">
            <p className="text-sm text-muted-foreground mb-4">
              Delete <strong>{page.title}</strong>? This action cannot be undone.
            </p>
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
