"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { FormDialog } from "@/components/shared/form-dialog";
import { createIntranetResource } from "@/actions/intranet";
import { Plus } from "lucide-react";

export function IntranetCreateButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm">
        <Plus className="h-4 w-4 mr-1" /> New Resource
      </Button>
      <FormDialog open={open} onClose={() => setOpen(false)} title="Create Resource" action={createIntranetResource} submitLabel="Create Resource">
        {({ fieldErrors }) => (
          <>
            <Input name="title" label="Title" required error={fieldErrors?.title?.[0]} />
            <Select
              name="category"
              label="Category"
              options={[
                { label: "Expense Report", value: "EXPENSE_REPORT" },
                { label: "Time Off", value: "TIME_OFF" },
                { label: "Org Chart", value: "ORG_CHART" },
                { label: "Announcement", value: "ANNOUNCEMENT" },
                { label: "HR Policy", value: "HR_POLICY" },
                { label: "SOP", value: "SOP" },
                { label: "General Resource", value: "GENERAL_RESOURCE" },
                { label: "Form", value: "FORM" },
                { label: "Other", value: "OTHER" },
              ]}
            />
            <Textarea name="description" label="Description" />
            <Textarea name="content" label="Content" className="min-h-[150px]" />
            <Input name="sortOrder" label="Sort Order" type="number" defaultValue="0" />
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="published" value="true" className="rounded" />
                Published
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="pinned" value="true" className="rounded" />
                Pinned
              </label>
            </div>
          </>
        )}
      </FormDialog>
    </>
  );
}
