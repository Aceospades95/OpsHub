"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { FormDialog } from "@/components/shared/form-dialog";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { updateTool, deleteTool, cloneTool } from "@/actions/tools";
import { Pencil, Trash2, Copy } from "lucide-react";

interface Props {
  tool: { id: string; name: string; description: string | null; category: string | null; toolUrl: string | null; toolType: string; isGlobal: boolean };
  canEdit: boolean;
  canDelete: boolean;
  canCreate: boolean;
}

export function ToolActions({ tool, canEdit, canDelete, canCreate }: Props) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [cloneError, setCloneError] = useState<string | null>(null);
  const [cloning, startCloning] = useTransition();
  const router = useRouter();

  async function runDelete() {
    const fd = new FormData();
    fd.set("id", tool.id);
    return deleteTool(null, fd);
  }

  function handleClone() {
    setCloneError(null);
    startCloning(async () => {
      try {
        const fd = new FormData();
        fd.set("id", tool.id);
        const result = await cloneTool(null, fd);
        if (result && "error" in result && result.error) {
          setCloneError(result.error);
          return;
        }
        router.refresh();
      } catch (err) {
        setCloneError(err instanceof Error ? err.message : "Clone failed");
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      {cloneError && (
        <div className="rounded bg-destructive/10 px-3 py-1 text-xs text-destructive">{cloneError}</div>
      )}
      <div className="flex gap-2">
      {canCreate && (
        <Button variant="outline" size="sm" onClick={handleClone} disabled={cloning}>
          <Copy className="h-4 w-4 mr-1" /> {cloning ? "Cloning…" : "Clone"}
        </Button>
      )}
      {canEdit && (
        <>
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}><Pencil className="h-4 w-4 mr-1" /> Edit</Button>
          <FormDialog open={editOpen} onClose={() => setEditOpen(false)} title="Edit Tool" action={updateTool}>
            {({ fieldErrors }) => (
              <>
                <input type="hidden" name="id" value={tool.id} />
                <Input name="name" label="Name" defaultValue={tool.name} required error={fieldErrors?.name?.[0]} />
                <Textarea name="description" label="Description" defaultValue={tool.description || ""} />
                <Select name="category" label="Category" defaultValue={tool.category || ""} options={["form","calculator","tracker","report","automation","other"].map(c => ({ label: c.charAt(0).toUpperCase()+c.slice(1), value: c }))} placeholder="Select" />
                <Select name="toolType" label="Type" defaultValue={tool.toolType} options={[{label:"Internal",value:"internal"},{label:"External",value:"external"},{label:"Embedded",value:"embedded"}]} />
                <Input name="toolUrl" label="Tool URL" defaultValue={tool.toolUrl || ""} />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="isGlobal" value="true" defaultChecked={tool.isGlobal} className="rounded" />
                  Global
                </label>
              </>
            )}
          </FormDialog>
        </>
      )}
      {canDelete && (
        <>
          <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}><Trash2 className="h-4 w-4 mr-1" /> Delete</Button>
          <ConfirmDialog
            open={deleteOpen}
            onClose={() => setDeleteOpen(false)}
            title="Delete Tool"
            message={
              <>
                Are you sure you want to delete <strong>{tool.name}</strong>?
                Project links to this tool will be removed; the projects
                themselves are unaffected. This cannot be undone.
              </>
            }
            onConfirm={runDelete}
            navigateTo="/tools"
            confirmLabel="Delete"
            successToast="Tool deleted"
          />
        </>
      )}
      </div>
    </div>
  );
}
