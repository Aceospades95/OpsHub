"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useFormState } from "react-dom";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import { linkToolToProject } from "@/actions/projects";
import { Plus } from "lucide-react";

interface AddToolButtonProps {
  projectId: string;
  availableTools: { id: string; name: string }[];
}

export function AddToolButton({ projectId, availableTools }: AddToolButtonProps) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useFormState(linkToolToProject, null);
  const router = useRouter();

  useEffect(() => {
    if (state?.success) {
      setOpen(false);
      router.refresh();
    }
  }, [state, router]);

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4 mr-1" />
        Link Tool
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Link Tool to Project">
        {state?.error && (
          <div className="mb-4 rounded bg-destructive/10 p-3 text-sm text-destructive">
            {state.error}
          </div>
        )}
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="projectId" value={projectId} />
          <Select
            name="toolId"
            label="Tool"
            placeholder="Select a tool"
            options={availableTools.map((t) => ({ label: t.name, value: t.id }))}
            required
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Link Tool</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
