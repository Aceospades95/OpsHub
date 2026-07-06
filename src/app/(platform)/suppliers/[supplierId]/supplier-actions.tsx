"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { FormDialog } from "@/components/shared/form-dialog";
import { SupplierCategorySelect } from "../supplier-category-select";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { updateSupplier, deleteSupplier } from "@/actions/suppliers";
import { Pencil, Trash2 } from "lucide-react";

interface Props {
  supplier: {
    id: string; name: string; category: string; contactName: string | null;
    contactTitle: string | null;
    contactEmail: string | null; contactPhone: string | null; location: string | null;
    address: string | null;
    website: string | null; notes: string | null; status: string; isPreferred: boolean;
  };
  /** Distinct categories already in the database (feeds the picker). */
  categories: string[];
  canEdit: boolean;
  canDelete: boolean;
}

export function SupplierActions({ supplier, categories, canEdit, canDelete }: Props) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  async function runDelete() {
    const fd = new FormData();
    fd.set("id", supplier.id);
    return deleteSupplier(null, fd);
  }

  return (
    <div className="flex gap-2">
      {canEdit && (
        <>
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}><Pencil className="h-4 w-4 mr-1" /> Edit</Button>
          <FormDialog open={editOpen} onClose={() => setEditOpen(false)} title="Edit Supplier" action={updateSupplier}>
            {({ fieldErrors }) => (
              <>
                <input type="hidden" name="id" value={supplier.id} />
                <Input name="name" label="Name" defaultValue={supplier.name} required error={fieldErrors?.name?.[0]} />
                <SupplierCategorySelect categories={categories} defaultValue={supplier.category} />
                <Select name="status" label="Status" defaultValue={supplier.status} options={[{label:"Active",value:"ACTIVE"},{label:"Inactive",value:"INACTIVE"},{label:"Archived",value:"ARCHIVED"}]} />
                <Input name="contactName" label="Contact Name" defaultValue={supplier.contactName || ""} />
                <Input name="contactTitle" label="Contact Title" defaultValue={supplier.contactTitle || ""} />
                <Input name="contactEmail" label="Contact Email" defaultValue={supplier.contactEmail || ""} />
                <Input name="contactPhone" label="Contact Phone" defaultValue={supplier.contactPhone || ""} />
                <Input name="location" label="Location (city / region)" defaultValue={supplier.location || ""} />
                <Textarea name="address" label="Address" defaultValue={supplier.address || ""} />
                <Input name="website" label="Website" defaultValue={supplier.website || ""} />
                <Textarea name="notes" label="Notes" defaultValue={supplier.notes || ""} />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="isPreferred" value="true" defaultChecked={supplier.isPreferred} className="rounded" />
                  Preferred Supplier
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
            title="Delete Supplier"
            message={
              <>
                Are you sure you want to delete <strong>{supplier.name}</strong>?
                Project links, attachments, and comments tied to this supplier
                will be removed. This cannot be undone.
              </>
            }
            onConfirm={runDelete}
            navigateTo="/suppliers"
            confirmLabel="Delete"
            successToast="Supplier deleted"
          />
        </>
      )}
    </div>
  );
}
