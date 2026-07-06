"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { FormDialog } from "@/components/shared/form-dialog";
import { createSupplier } from "@/actions/suppliers";
import { Plus } from "lucide-react";

export function SupplierCreateButton() {
  const [open, setOpen] = useState(false);

  const categories = [
    "auto_repair", "decals", "alarm_security", "maintenance",
    "it_services", "office_supplies", "other",
  ];

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm">
        <Plus className="h-4 w-4 mr-1" /> New Supplier
      </Button>
      <FormDialog open={open} onClose={() => setOpen(false)} title="Create Supplier" action={createSupplier} submitLabel="Create Supplier">
        {({ fieldErrors }) => (
          <>
            <Input name="name" label="Name" required error={fieldErrors?.name?.[0]} />
            <Select
              name="category"
              label="Category"
              options={categories.map(c => ({ label: c.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase()), value: c }))}
              placeholder="Select category"
              required
            />
            <Select
              name="status"
              label="Status"
              options={[{label:"Active",value:"ACTIVE"},{label:"Inactive",value:"INACTIVE"},{label:"Archived",value:"ARCHIVED"}]}
            />
            <Input name="contactName" label="Contact Name" />
            <Input name="contactEmail" label="Contact Email" type="email" />
            <Input name="contactPhone" label="Contact Phone" />
            <Input name="location" label="Location (city / region)" />
            <Textarea name="address" label="Address" />
            <Input name="website" label="Website" />
            <Textarea name="notes" label="Notes" />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="isPreferred" value="true" className="rounded" />
              Preferred Supplier
            </label>
          </>
        )}
      </FormDialog>
    </>
  );
}
