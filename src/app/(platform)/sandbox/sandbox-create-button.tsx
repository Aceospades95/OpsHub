"use client";

import { useState, useEffect } from "react";
import { useFormState } from "react-dom";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { createSandboxPage } from "@/actions/sandbox";
import { Plus } from "lucide-react";

interface Props {
  projects: { id: string; name: string }[];
  clients: { id: string; name: string }[];
}

export function SandboxCreateButton({ projects, clients }: Props) {
  const [open, setOpen] = useState(false);
  const [state, action] = useFormState(createSandboxPage, null);
  const router = useRouter();

  useEffect(() => {
    if (state?.success) {
      setOpen(false);
      router.refresh();
    }
  }, [state, router]);

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm">
        <Plus className="h-4 w-4 mr-1" /> New Page
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Create Sandbox Page">
        <form action={action} className="space-y-4">
          {state?.error && (
            <p className="text-sm text-destructive">{state.error}</p>
          )}
          <Input name="title" label="Title" required />
          <Input name="slug" label="URL Slug" placeholder="my-page-name" required />
          <Textarea name="description" label="Description" />
          <Textarea name="content" label="Content" rows={6} />
          <Select
            name="layout"
            label="Layout"
            options={[
              { label: "Default", value: "default" },
              { label: "Wide", value: "wide" },
              { label: "Full Width", value: "full" },
            ]}
          />
          <Select
            name="projectId"
            label="Associated Project"
            options={[
              { label: "None", value: "" },
              ...projects.map((p) => ({ label: p.name, value: p.id })),
            ]}
          />
          <Select
            name="clientId"
            label="Associated Client"
            options={[
              { label: "None", value: "" },
              ...clients.map((c) => ({ label: c.name, value: c.id })),
            ]}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Create Page</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
