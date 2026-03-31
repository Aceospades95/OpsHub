"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { FormDialog } from "@/components/shared/form-dialog";
import { createClient } from "@/actions/clients";
import { Plus } from "lucide-react";

export function ClientCreateButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm">
        <Plus className="h-4 w-4 mr-1" />
        New Client
      </Button>
      <FormDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Create Client"
        action={createClient}
        submitLabel="Create Client"
      >
        {({ fieldErrors }) => (
          <>
            <Input name="name" label="Client Name" required error={fieldErrors?.name?.[0]} />
            <Input name="industry" label="Industry" />
            <Input name="website" label="Website" />
            <Textarea name="description" label="Description" />
            <Textarea name="summary" label="Summary" placeholder="History, goals, context..." />
            <Select
              name="status"
              label="Status"
              options={[
                { label: "Active", value: "ACTIVE" },
                { label: "Prospect", value: "PROSPECT" },
                { label: "Inactive", value: "INACTIVE" },
                { label: "Archived", value: "ARCHIVED" },
              ]}
            />
          </>
        )}
      </FormDialog>
    </>
  );
}
