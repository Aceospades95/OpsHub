"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toCalendarDateString } from "@/lib/dates";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { FormDialog } from "@/components/shared/form-dialog";
import { createVehicle } from "@/actions/fleet";
import { Plus } from "lucide-react";

export const VEHICLE_STATUS_OPTIONS = [
  { label: "Active", value: "ACTIVE" },
  { label: "In shop", value: "IN_SHOP" },
  { label: "Retired", value: "RETIRED" },
  { label: "Sold", value: "SOLD" },
];

/** Shared field set for the create + edit dialogs. */
export function VehicleFields({
  vehicle,
  users,
  fieldErrors,
}: {
  vehicle?: {
    nickname: string | null;
    make: string;
    model: string;
    year: number;
    vin: string | null;
    licensePlate: string | null;
    status: string;
    assignedToId: string | null;
    currentMileage: number | null;
    nextServiceDate: string | null;
    nextServiceMileage: number | null;
    registrationExpiresAt: string | null;
    notes: string | null;
  };
  users: { id: string; name: string }[];
  fieldErrors?: Record<string, string[] | undefined>;
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <Input name="make" label="Make" required defaultValue={vehicle?.make ?? ""} error={fieldErrors?.make?.[0]} />
        <Input name="model" label="Model" required defaultValue={vehicle?.model ?? ""} error={fieldErrors?.model?.[0]} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Input
          name="year"
          label="Year"
          type="number"
          required
          defaultValue={vehicle ? String(vehicle.year) : ""}
          error={fieldErrors?.year?.[0]}
        />
        <Input name="nickname" label="Nickname (optional)" placeholder='e.g. "Van #3"' defaultValue={vehicle?.nickname ?? ""} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Input name="vin" label="VIN" defaultValue={vehicle?.vin ?? ""} error={fieldErrors?.vin?.[0]} />
        <Input name="licensePlate" label="License plate" defaultValue={vehicle?.licensePlate ?? ""} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Select
          name="status"
          label="Status"
          defaultValue={vehicle?.status ?? "ACTIVE"}
          options={VEHICLE_STATUS_OPTIONS}
        />
        <Select
          name="assignedToId"
          label="Assigned driver"
          defaultValue={vehicle?.assignedToId ?? ""}
          options={[{ label: "Unassigned", value: "" }, ...users.map((u) => ({ label: u.name, value: u.id }))]}
        />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <Input
          name="currentMileage"
          label="Current mileage"
          type="number"
          defaultValue={vehicle?.currentMileage != null ? String(vehicle.currentMileage) : ""}
        />
        <Input
          name="nextServiceDate"
          label="Next service date"
          type="date"
          defaultValue={toCalendarDateString(vehicle?.nextServiceDate)}
        />
        <Input
          name="nextServiceMileage"
          label="…or at mileage"
          type="number"
          defaultValue={vehicle?.nextServiceMileage != null ? String(vehicle.nextServiceMileage) : ""}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Input
          name="registrationExpiresAt"
          label="Registration expires"
          type="date"
          defaultValue={toCalendarDateString(vehicle?.registrationExpiresAt)}
        />
      </div>
      <Textarea name="notes" label="Notes" defaultValue={vehicle?.notes ?? ""} />
    </>
  );
}

export function VehicleCreateButton({ users }: { users: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm">
        <Plus className="h-4 w-4 mr-1" /> Add Vehicle
      </Button>
      <FormDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Add vehicle"
        action={createVehicle}
        submitLabel="Add vehicle"
      >
        {({ fieldErrors }) => <VehicleFields users={users} fieldErrors={fieldErrors} />}
      </FormDialog>
    </>
  );
}
