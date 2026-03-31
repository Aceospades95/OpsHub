"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { FormDialog } from "@/components/shared/form-dialog";
import { Dialog } from "@/components/ui/dialog";
import { updateSupplier, deleteSupplier } from "@/actions/suppliers";
import { Pencil, Trash2 } from "lucide-react";

interface Props {
  supplier: {
    id: string; name: string; category: string; contactName: string | null;
    contactEmail: string | null; contactPhone: string | null; address: string | null;
    website: string | null; notes: string | null; status: string; isPreferred: boolean;
  };
  canEdit: boolean;
  canDelete: boolean;
}

const categories = ["auto_repair","decals","alarm_security","maintenance","it_services","office_supplies","other"];

export function SupplierActions({ supplier, canEdit, canDelete }: Props) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const router = useRouter();

  async function handleDelete() {
    const fd = new FormData();
    fd.set("id", supplier.id);
    const result = await deleteSupplier(null, fd);
    if (result.success) router.push("/suppliers");
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
                <Select name="category" label="Category" defaultValue={supplier.category} options={categories.map(c => ({ label: c.replace(/_/g," ").replace(/\b\w/g,l=>l.toUpperCase()), value: c }))} />
                <Select name="status" label="Status" defaultValue={supplier.status} options={[{label:"Active",value:"ACTIVE"},{label:"Inactive",value:"INACTIVE"},{label:"Archived",value:"ARCHIVED"}]} />
                <Input name="contactName" label="Contact Name" defaultValue={supplier.contactName || ""} />
                <Input name="contactEmail" label="Contact Email" defaultValue={supplier.contactEmail || ""} />
                <Input name="contactPhone" label="Contact Phone" defaultValue={supplier.contactPhone || ""} />
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
          <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete Supplier">
            <p className="text-sm text-muted-foreground mb-4">Delete <strong>{supplier.name}</strong>?</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
              <Button variant="destructive" onClick={handleDelete}>Delete</Button>
            </div>
          </Dialog>
        </>
      )}
    </div>
  );
}
