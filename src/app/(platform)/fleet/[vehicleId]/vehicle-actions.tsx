"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/shared/form-dialog";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { updateVehicle, deleteVehicle } from "@/actions/fleet";
import { VehicleFields } from "../vehicle-create-button";
import { Pencil, Trash2 } from "lucide-react";

interface Props {
  vehicle: {
    id: string;
    nickname: string | null;
    make: string;
    model: string;
    year: number;
    vin: string | null;
    licensePlate: string | null;
    status: string;
    assignedToId: string | null;
    currentMileage: number | null;
    /** ISO string or null — serialized server-side. */
    nextServiceDate: string | null;
    nextServiceMileage: number | null;
    notes: string | null;
  };
  users: { id: string; name: string }[];
  canEdit: boolean;
  canDelete: boolean;
}

export function VehicleActions({ vehicle, users, canEdit, canDelete }: Props) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  async function runDelete() {
    const fd = new FormData();
    fd.set("id", vehicle.id);
    return deleteVehicle(null, fd);
  }

  return (
    <div className="flex gap-2">
      {canEdit && (
        <>
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4 mr-1" /> Edit
          </Button>
          <FormDialog
            open={editOpen}
            onClose={() => setEditOpen(false)}
            title="Edit vehicle"
            action={updateVehicle}
          >
            {({ fieldErrors }) => (
              <>
                <input type="hidden" name="id" value={vehicle.id} />
                <VehicleFields vehicle={vehicle} users={users} fieldErrors={fieldErrors} />
              </>
            )}
          </FormDialog>
        </>
      )}
      {canDelete && (
        <>
          <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-4 w-4 mr-1" /> Delete
          </Button>
          <ConfirmDialog
            open={deleteOpen}
            onClose={() => setDeleteOpen(false)}
            title="Delete vehicle"
            message="The vehicle and its maintenance history move to the recovery bin."
            confirmLabel="Delete"
            onConfirm={runDelete}
            navigateTo="/fleet"
            successToast="Vehicle deleted"
          />
        </>
      )}
    </div>
  );
}
