"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { FormDialog } from "@/components/shared/form-dialog";
import { createSandboxPage } from "@/actions/sandbox";
import { Plus } from "lucide-react";

interface Props {
  projects: { id: string; name: string }[];
  clients: { id: string; name: string }[];
}

/**
 * Round-7 QA: migrated off raw <Dialog> + inline action buttons to
 * the shared FormDialog. The new FormDialog uses the dialog's
 * sticky footer slot, so Cancel / Create stay visible at the
 * bottom of the modal even when the form is taller than the
 * viewport. Round-6 P1-R6-D shipped the FormDialog change; this
 * page was the last hold-out still rendering its own form
 * element.
 */
export function SandboxCreateButton({ projects, clients }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm">
        <Plus className="h-4 w-4 mr-1" /> New Page
      </Button>
      <FormDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Create Sandbox Page"
        action={createSandboxPage}
        submitLabel="Create Page"
      >
        {({ fieldErrors }) => (
          <>
            <Input name="title" label="Title" required error={fieldErrors?.title?.[0]} />
            <Input
              name="slug"
              label="URL Slug"
              placeholder="my-page-name"
              required
              error={fieldErrors?.slug?.[0]}
            />
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
          </>
        )}
      </FormDialog>
    </>
  );
}
