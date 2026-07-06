"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormDialog } from "@/components/shared/form-dialog";
import { useConfirm } from "@/components/shared/use-confirm";
import { addMaintenanceRecord, deleteMaintenanceRecord } from "@/actions/fleet";
import { Plus, Trash2, Wrench } from "lucide-react";

export interface MaintenanceRow {
  id: string;
  /** ISO strings — serialized server-side. */
  serviceDate: string;
  serviceType: string;
  odometer: number | null;
  cost: number | null;
  vendor: string | null;
  notes: string | null;
  nextDueDate: string | null;
}

/**
 * Maintenance history for a vehicle. Logging a record with a "next due"
 * date rolls the vehicle's service schedule forward and re-arms the
 * due-soon notification.
 */
export function MaintenanceSection({
  vehicleId,
  records,
  canEdit,
  canDelete,
}: {
  vehicleId: string;
  records: MaintenanceRow[];
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [, startTransition] = useTransition();
  const { confirm, ConfirmDialog } = useConfirm();
  const router = useRouter();

  async function handleDelete(record: MaintenanceRow) {
    const ok = await confirm({
      title: `Delete "${record.serviceType}" record?`,
      message: "This can't be undone.",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    const fd = new FormData();
    fd.set("id", record.id);
    const result = await deleteMaintenanceRecord(null, fd);
    if (result && "error" in result && result.error) {
      toast.error(result.error);
      return;
    }
    toast.success("Record deleted");
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-3">
      {records.length === 0 ? (
        <p className="text-sm text-muted-foreground">No maintenance logged yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Date</th>
                <th className="py-2 pr-3 font-medium">Service</th>
                <th className="py-2 pr-3 font-medium text-right">Odometer</th>
                <th className="py-2 pr-3 font-medium text-right">Cost</th>
                <th className="py-2 pr-3 font-medium">Vendor</th>
                <th className="py-2 pr-3 font-medium">Next due</th>
                {canDelete && <th className="py-2 font-medium" />}
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id} className="border-b border-border last:border-0 align-top">
                  <td className="py-2.5 pr-3 whitespace-nowrap">
                    {format(new Date(record.serviceDate), "MMM d, yyyy")}
                  </td>
                  <td className="py-2.5 pr-3">
                    <span className="font-medium">{record.serviceType}</span>
                    {record.notes && (
                      <p className="text-xs text-muted-foreground whitespace-pre-wrap">{record.notes}</p>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-muted-foreground">
                    {record.odometer != null ? record.odometer.toLocaleString() : "—"}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-muted-foreground">
                    {record.cost != null
                      ? record.cost.toLocaleString("en-US", { style: "currency", currency: "USD" })
                      : "—"}
                  </td>
                  <td className="py-2.5 pr-3 text-muted-foreground">{record.vendor || "—"}</td>
                  <td className="py-2.5 pr-3 text-muted-foreground whitespace-nowrap">
                    {record.nextDueDate ? format(new Date(record.nextDueDate), "MMM d, yyyy") : "—"}
                  </td>
                  {canDelete && (
                    <td className="py-2.5 text-right">
                      <button
                        onClick={() => handleDelete(record)}
                        aria-label={`Delete ${record.serviceType} record`}
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
            <Plus className="h-4 w-4 mr-1" /> Log maintenance
          </Button>
          <FormDialog
            open={addOpen}
            onClose={() => setAddOpen(false)}
            title="Log maintenance"
            action={addMaintenanceRecord}
            submitLabel="Save record"
          >
            {({ fieldErrors }) => (
              <>
                <input type="hidden" name="vehicleId" value={vehicleId} />
                <div className="grid grid-cols-2 gap-4">
                  <Input name="serviceDate" label="Service date" type="date" required error={fieldErrors?.serviceDate?.[0]} />
                  <Input
                    name="serviceType"
                    label="Service performed"
                    placeholder='e.g. "Oil change"'
                    required
                    error={fieldErrors?.serviceType?.[0]}
                  />
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <Input name="odometer" label="Odometer" type="number" />
                  <Input name="cost" label="Cost" type="number" step="0.01" />
                  <Input name="vendor" label="Vendor / shop" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Input name="nextDueDate" label="Next service due" type="date" />
                  <Input name="nextDueMileage" label="…or at mileage" type="number" />
                </div>
                <p className="text-xs text-muted-foreground -mt-1 flex items-center gap-1">
                  <Wrench className="h-3 w-3" />
                  Setting a next-due date updates the vehicle&apos;s service schedule and re-arms the reminder.
                </p>
                <Textarea name="notes" label="Notes" />
              </>
            )}
          </FormDialog>
        </>
      )}
      <ConfirmDialog />
    </div>
  );
}
