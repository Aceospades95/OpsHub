"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormDialog } from "@/components/shared/form-dialog";
import { toCalendarDateString } from "@/lib/dates";
import { logMaintenance } from "@/actions/fleet";
import { Wrench } from "lucide-react";

/**
 * The driver submission flow: "I got the oil changed" in one dialog.
 * One shop visit can cover several service types — the checkboxes come
 * from the vehicle's own service schedules (checking one re-arms that
 * schedule), and anything else goes in the free-text "Other" field.
 *
 * Rendered for fleet editors AND for the vehicle's assigned driver
 * (the server action re-checks both). Used from the vehicle detail
 * header and from the fleet list rows, so keep it self-contained.
 */
export function LogMaintenanceButton({
  vehicleId,
  vehicleName,
  currentMileage,
  scheduleServiceTypes,
  size = "sm",
  variant = "default",
  className = "",
}: {
  vehicleId: string;
  vehicleName: string;
  currentMileage: number | null;
  /** serviceTypes of this vehicle's schedules — the checkbox options. */
  scheduleServiceTypes: string[];
  size?: "sm" | "default";
  variant?: "default" | "outline";
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        size={size}
        variant={variant}
        className={className}
        onClick={(e) => {
          // The list card wraps rows in a <Link>; never navigate when
          // the intent was to open this dialog.
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <Wrench className="h-4 w-4 mr-1" /> Log maintenance
      </Button>
      {/* Mounted per open so useFormState starts fresh each time. */}
      {open && (
      <FormDialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Log maintenance — ${vehicleName}`}
        action={logMaintenance}
        submitLabel="Submit"
      >
        {({ fieldErrors }) => (
          <>
            <input type="hidden" name="vehicleId" value={vehicleId} />
            <div className="grid grid-cols-2 gap-4">
              <Input
                name="serviceDate"
                label="Service date"
                type="date"
                required
                defaultValue={toCalendarDateString(new Date())}
                error={fieldErrors?.serviceDate?.[0]}
              />
              <Input
                name="odometer"
                label="Odometer (mi)"
                type="number"
                min={0}
                defaultValue={currentMileage != null ? String(currentMileage) : ""}
                error={fieldErrors?.odometer?.[0]}
              />
            </div>

            <fieldset className="space-y-1">
              <legend className="block text-sm font-medium text-foreground">
                What was done?
              </legend>
              {scheduleServiceTypes.length > 0 && (
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 pt-1">
                  {scheduleServiceTypes.map((type) => (
                    <label key={type} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        name="serviceTypes"
                        value={type}
                        className="rounded accent-primary"
                      />
                      <span className="truncate" title={type}>{type}</span>
                    </label>
                  ))}
                </div>
              )}
              <Input
                name="otherServiceType"
                placeholder={
                  scheduleServiceTypes.length > 0
                    ? 'Other… (e.g. "Wiper blades")'
                    : 'e.g. "Oil change"'
                }
                aria-label="Other service type"
              />
              <p className="text-xs text-muted-foreground">
                Checked items roll their service schedule forward and reset the reminders.
              </p>
            </fieldset>

            <div className="grid grid-cols-2 gap-4">
              <Input name="cost" label="Cost" type="number" step="0.01" min={0} />
              <Input name="vendor" label="Vendor / shop" />
            </div>
            <Textarea name="notes" label="Notes" />
            <p className="text-xs text-muted-foreground -mt-2">
              Got a receipt? Paste a link to the photo (Drive, etc.) in the notes so the
              office can find it.
            </p>
          </>
        )}
      </FormDialog>
      )}
    </>
  );
}
