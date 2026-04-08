"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormDialog } from "@/components/shared/form-dialog";
import { createIntranetResource } from "@/actions/intranet";
import { Plus } from "lucide-react";

interface Props {
  category: string;
  categoryLabel: string;
}

export function IntranetCategoryAdd({ category, categoryLabel }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm" variant="outline">
        <Plus className="h-4 w-4 mr-1" /> Add to {categoryLabel}
      </Button>
      <FormDialog
        open={open}
        onClose={() => setOpen(false)}
        title={`New ${categoryLabel} Resource`}
        action={createIntranetResource}
        submitLabel="Create Resource"
      >
        {({ fieldErrors }) => (
          <>
            <Input name="title" label="Title" required error={fieldErrors?.title?.[0]} />
            {/* Pre-select the category */}
            <input type="hidden" name="category" value={category} />
            <Textarea name="description" label="Description" />
            <Textarea name="content" label="Content" className="min-h-[150px]" />
            <Input name="sortOrder" label="Sort Order" type="number" defaultValue="0" />
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="published" value="true" defaultChecked className="rounded" />
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
