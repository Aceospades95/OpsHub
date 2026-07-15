"use client";

import { useEffect, useState } from "react";
import { useFormState } from "react-dom";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { updateVehicleMileage } from "@/actions/fleet";
import { Gauge } from "lucide-react";

/**
 * Standalone odometer update — no maintenance record required. Shown to
 * fleet editors and the vehicle's assigned driver; drivers can only
 * roll the number forward (typo protection), editors can correct in
 * either direction.
 */
export function UpdateMileageButton({
  vehicleId,
  currentMileage,
  size = "sm",
}: {
  vehicleId: string;
  currentMileage: number | null;
  size?: "sm" | "default";
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useFormState(updateVehicleMileage, null);
  const router = useRouter();

  useEffect(() => {
    if (state && "success" in state && state.success) {
      setOpen(false);
      router.refresh();
    }
  }, [state, router]);

  return (
    <>
      <Button variant="outline" size={size} onClick={() => setOpen(true)}>
        <Gauge className="h-4 w-4 mr-1.5" />
        Update mileage
      </Button>
      {open && (
        <Dialog open onClose={() => setOpen(false)} title="Update mileage">
          <form action={action} className="space-y-4">
            <input type="hidden" name="vehicleId" value={vehicleId} />
            <Input
              name="mileage"
              label="Current odometer reading (miles)"
              type="number"
              min="0"
              defaultValue={currentMileage ?? undefined}
              placeholder="e.g. 48250"
              required
            />
            <p className="text-xs text-muted-foreground">
              Mileage drives the service-schedule due estimates — keeping it
              fresh keeps the reminders honest.
            </p>
            {state && "error" in state && state.error && (
              <p className="text-sm text-destructive">{state.error}</p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Save mileage</Button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
