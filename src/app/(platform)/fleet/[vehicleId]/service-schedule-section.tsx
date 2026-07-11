"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { formatCalendarDate, toCalendarDateString } from "@/lib/dates";
import { scheduleCadenceLabel } from "@/lib/fleet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormDialog } from "@/components/shared/form-dialog";
import { useConfirm } from "@/components/shared/use-confirm";
import {
  createServiceSchedule,
  updateServiceSchedule,
  deleteServiceSchedule,
} from "@/actions/fleet";
import { Pencil, Plus, Trash2 } from "lucide-react";

export type ScheduleDueStatusLabel = "ok" | "due-soon" | "overdue" | "unknown";

export interface ScheduleTableRow {
  id: string;
  serviceType: string;
  everyMonths: number | null;
  everyMiles: number | null;
  /** ISO strings — serialized server-side. */
  lastServiceDate: string | null;
  lastServiceMileage: number | null;
  notes: string | null;
  /** Computed server-side via lib/fleet scheduleDueState. */
  due: {
    dueDate: string | null;
    dueMileage: number | null;
    status: ScheduleDueStatusLabel;
  };
}

const STATUS_BADGE: Record<
  ScheduleDueStatusLabel,
  { label: string; variant: "success" | "warning" | "destructive" | "outline" }
> = {
  ok: { label: "OK", variant: "success" },
  "due-soon": { label: "Due soon", variant: "warning" },
  overdue: { label: "Overdue", variant: "destructive" },
  unknown: { label: "No baseline", variant: "outline" },
};

export function ScheduleStatusBadge({ status }: { status: ScheduleDueStatusLabel }) {
  const meta = STATUS_BADGE[status];
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}

function ScheduleFields({
  schedule,
  fieldErrors,
}: {
  schedule?: ScheduleTableRow;
  fieldErrors?: Record<string, string[] | undefined>;
}) {
  return (
    <>
      <Input
        name="serviceType"
        label="Service type"
        placeholder='e.g. "Oil Change"'
        required
        defaultValue={schedule?.serviceType ?? ""}
        error={fieldErrors?.serviceType?.[0]}
      />
      <div className="grid grid-cols-2 gap-4">
        <Input
          name="everyMonths"
          label="Every (months)"
          type="number"
          min={1}
          defaultValue={schedule?.everyMonths != null ? String(schedule.everyMonths) : ""}
          error={fieldErrors?.everyMonths?.[0]}
        />
        <Input
          name="everyMiles"
          label="…and/or every (miles)"
          type="number"
          min={1}
          defaultValue={schedule?.everyMiles != null ? String(schedule.everyMiles) : ""}
          error={fieldErrors?.everyMiles?.[0]}
        />
      </div>
      <p className="text-xs text-muted-foreground -mt-2">
        Due when either bound trips first. Set at least one.
      </p>
      <div className="grid grid-cols-2 gap-4">
        <Input
          name="lastServiceDate"
          label="Last done (date)"
          type="date"
          defaultValue={toCalendarDateString(schedule?.lastServiceDate)}
          error={fieldErrors?.lastServiceDate?.[0]}
        />
        <Input
          name="lastServiceMileage"
          label="Last done (mileage)"
          type="number"
          min={0}
          defaultValue={
            schedule?.lastServiceMileage != null ? String(schedule.lastServiceMileage) : ""
          }
          error={fieldErrors?.lastServiceMileage?.[0]}
        />
      </div>
      <Textarea name="notes" label="Notes" defaultValue={schedule?.notes ?? ""} />
    </>
  );
}

/**
 * Per-service-type recurring plans — the "Oil Change every 3 mo /
 * 4,000 mi" table from the fleet spreadsheet. Logging maintenance for
 * a matching service type moves "last done" forward automatically;
 * these dialogs are for setting cadences and correcting baselines.
 */
export function ServiceScheduleSection({
  vehicleId,
  schedules,
  canEdit,
}: {
  vehicleId: string;
  schedules: ScheduleTableRow[];
  canEdit: boolean;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<ScheduleTableRow | null>(null);
  const [, startTransition] = useTransition();
  const { confirm, ConfirmDialog } = useConfirm();
  const router = useRouter();

  async function handleDelete(schedule: ScheduleTableRow) {
    const ok = await confirm({
      title: `Delete the "${schedule.serviceType}" schedule?`,
      message: "Logged maintenance history stays; only the recurring plan is removed.",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    const fd = new FormData();
    fd.set("id", schedule.id);
    const result = await deleteServiceSchedule(null, fd);
    if (result && "error" in result && result.error) {
      toast.error(result.error);
      return;
    }
    toast.success("Schedule deleted");
    startTransition(() => router.refresh());
  }

  const lastDone = (schedule: ScheduleTableRow) => {
    if (!schedule.lastServiceDate && schedule.lastServiceMileage == null) return "—";
    const parts: string[] = [];
    if (schedule.lastServiceDate) {
      parts.push(formatCalendarDate(schedule.lastServiceDate, "MMM d, yyyy"));
    }
    if (schedule.lastServiceMileage != null) {
      parts.push(`${schedule.lastServiceMileage.toLocaleString()} mi`);
    }
    return parts.join(" @ ");
  };

  const nextDue = (schedule: ScheduleTableRow) => {
    const parts: string[] = [];
    if (schedule.due.dueDate) {
      parts.push(formatCalendarDate(schedule.due.dueDate, "MMM d, yyyy"));
    }
    if (schedule.due.dueMileage != null) {
      parts.push(`${schedule.due.dueMileage.toLocaleString()} mi`);
    }
    return parts.length > 0 ? parts.join(" / ") : "—";
  };

  return (
    <div className="space-y-3">
      {schedules.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No recurring services configured yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Service</th>
                <th className="py-2 pr-3 font-medium">Cadence</th>
                <th className="py-2 pr-3 font-medium">Last done</th>
                <th className="py-2 pr-3 font-medium">Next due</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                {canEdit && <th className="py-2 font-medium" />}
              </tr>
            </thead>
            <tbody>
              {schedules.map((schedule) => (
                <tr key={schedule.id} className="border-b border-border last:border-0 align-top">
                  <td className="py-2.5 pr-3">
                    <span className="font-medium">{schedule.serviceType}</span>
                    {schedule.notes && (
                      <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                        {schedule.notes}
                      </p>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 text-muted-foreground whitespace-nowrap">
                    {scheduleCadenceLabel(schedule)}
                  </td>
                  <td className="py-2.5 pr-3 text-muted-foreground whitespace-nowrap">
                    {lastDone(schedule)}
                  </td>
                  <td className="py-2.5 pr-3 text-muted-foreground whitespace-nowrap">
                    {nextDue(schedule)}
                  </td>
                  <td className="py-2.5 pr-3">
                    <ScheduleStatusBadge status={schedule.due.status} />
                  </td>
                  {canEdit && (
                    <td className="py-2.5 text-right whitespace-nowrap">
                      <button
                        onClick={() => setEditing(schedule)}
                        aria-label={`Edit ${schedule.serviceType} schedule`}
                        className="rounded p-1 text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(schedule)}
                        aria-label={`Delete ${schedule.serviceType} schedule`}
                        className="rounded p-1 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canEdit && (
        <>
          <Button variant="outline" size="sm" className="w-full" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Add service schedule
          </Button>
          {/* Mounted per open so useFormState (and the row being
              edited) starts fresh each time. */}
          {addOpen && (
            <FormDialog
              open={addOpen}
              onClose={() => setAddOpen(false)}
              title="Add service schedule"
              action={createServiceSchedule}
              submitLabel="Add schedule"
            >
              {({ fieldErrors }) => (
                <>
                  <input type="hidden" name="vehicleId" value={vehicleId} />
                  <ScheduleFields fieldErrors={fieldErrors} />
                </>
              )}
            </FormDialog>
          )}
          {editing != null && (
            <FormDialog
              key={editing.id}
              open
              onClose={() => setEditing(null)}
              title={`Edit "${editing.serviceType}" schedule`}
              action={updateServiceSchedule}
            >
              {({ fieldErrors }) => (
                <>
                  <input type="hidden" name="id" value={editing.id} />
                  <ScheduleFields schedule={editing} fieldErrors={fieldErrors} />
                </>
              )}
            </FormDialog>
          )}
        </>
      )}
      <ConfirmDialog />
    </div>
  );
}
