"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { FormDialog } from "@/components/shared/form-dialog";
import { createTool } from "@/actions/tools";
import { Plus } from "lucide-react";

export function ToolCreateButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm">
        <Plus className="h-4 w-4 mr-1" /> New Tool
      </Button>
      <FormDialog open={open} onClose={() => setOpen(false)} title="Create Tool" action={createTool} submitLabel="Create Tool">
        {({ fieldErrors }) => (
          <>
            <Input name="name" label="Name" required error={fieldErrors?.name?.[0]} />
            <Textarea name="description" label="Description" />
            <Select name="category" label="Category" options={["form","calculator","tracker","report","automation","other"].map(c => ({ label: c.charAt(0).toUpperCase() + c.slice(1), value: c }))} placeholder="Select category" />
            <Select name="toolType" label="Type" options={[{label:"Internal",value:"internal"},{label:"External",value:"external"},{label:"Embedded",value:"embedded"}]} />
            <Input name="toolUrl" label="Tool URL" />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="isGlobal" value="true" defaultChecked className="rounded" />
              Global (visible to all)
            </label>
          </>
        )}
      </FormDialog>
    </>
  );
}
