"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { format } from "date-fns";
import { formatCalendarDate, toCalendarDateString } from "@/lib/dates";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { FormDialog } from "@/components/shared/form-dialog";
import { useConfirm } from "@/components/shared/use-confirm";
import {
  createDisciplinaryReport,
  updateDisciplinaryReport,
  setDisciplinaryAcknowledged,
  deleteDisciplinaryReport,
} from "@/actions/disciplinary";
import { DISCIPLINARY_ACTION_TYPES, DISCIPLINARY_ACTION_LABELS } from "@/lib/disciplinary";
import { FileWarning, Plus, Pencil, Trash2, FileDown, CheckCircle2 } from "lucide-react";

export interface DisciplinaryReportRow {
  id: string;
  actionType: string;
  /** ISO strings — serialized server-side. */
  incidentDate: string;
  createdAt: string;
  followUpDate: string | null;
  acknowledgedAt: string | null;
  description: string;
  actionTaken: string | null;
  improvementPlan: string | null;
  witnesses: string | null;
  notes: string | null;
  issuedByName: string;
}

const ACTION_OPTIONS = DISCIPLINARY_ACTION_TYPES.map((t) => ({
  value: t,
  label: DISCIPLINARY_ACTION_LABELS[t],
}));

/**
 * Disciplinary action reports on the employee profile. Rendered only for
 * ADMIN/MANAGER viewers (the tab itself is gated); every action re-checks
 * server-side. "Export PDF" produces the signable document that replaces
 * the old spreadsheet template.
 */
export function DisciplinaryTab({
  employeeId,
  employeeName,
  reports,
  isAdmin,
}: {
  employeeId: string;
  employeeName: string;
  reports: DisciplinaryReportRow[];
  isAdmin: boolean;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editReport, setEditReport] = useState<DisciplinaryReportRow | null>(null);
  const [, startTransition] = useTransition();
  const { confirm, ConfirmDialog } = useConfirm();
  const router = useRouter();

  async function toggleAcknowledged(report: DisciplinaryReportRow) {
    const fd = new FormData();
    fd.set("id", report.id);
    fd.set("acknowledged", report.acknowledgedAt ? "false" : "true");
    const result = await setDisciplinaryAcknowledged(null, fd);
    if (result && "error" in result && result.error) {
      toast.error(result.error);
      return;
    }
    startTransition(() => router.refresh());
  }

  async function handleDelete(report: DisciplinaryReportRow) {
    const ok = await confirm({
      title: "Delete this disciplinary report?",
      message: "It moves to the recovery bin and disappears from the personnel record.",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    const fd = new FormData();
    fd.set("id", report.id);
    const result = await deleteDisciplinaryReport(null, fd);
    if (result && "error" in result && result.error) {
      toast.error(result.error);
      return;
    }
    toast.success("Report deleted");
    startTransition(() => router.refresh());
  }

  const formFields = (report: DisciplinaryReportRow | null, fieldErrors?: Record<string, string[] | undefined>) => (
    <>
      {report && <input type="hidden" name="id" value={report.id} />}
      <input type="hidden" name="employeeId" value={employeeId} />
      <div className="grid grid-cols-2 gap-4">
        <Select
          name="actionType"
          label="Action type"
          defaultValue={report?.actionType ?? "WRITTEN_WARNING"}
          options={ACTION_OPTIONS}
        />
        <Input
          name="incidentDate"
          label="Date of incident"
          type="date"
          required
          defaultValue={report ? toCalendarDateString(report.incidentDate) : ""}
        />
      </div>
      <Textarea
        name="description"
        label="Description of incident"
        required
        rows={4}
        defaultValue={report?.description ?? ""}
        error={fieldErrors?.description?.[0]}
      />
      <Textarea
        name="actionTaken"
        label="Action taken"
        rows={3}
        defaultValue={report?.actionTaken ?? ""}
      />
      <Textarea
        name="improvementPlan"
        label="Expected improvement"
        rows={3}
        defaultValue={report?.improvementPlan ?? ""}
      />
      <div className="grid grid-cols-2 gap-4">
        <Input name="witnesses" label="Witnesses" defaultValue={report?.witnesses ?? ""} />
        <Input
          name="followUpDate"
          label="Follow-up review date"
          type="date"
          defaultValue={report ? toCalendarDateString(report.followUpDate) : ""}
        />
      </div>
      <Textarea name="notes" label="Internal notes (not on the PDF)" rows={2} defaultValue={report?.notes ?? ""} />
    </>
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <FileWarning className="h-4 w-4" />
            Disciplinary reports ({reports.length})
          </CardTitle>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> New report
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {reports.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No disciplinary reports on file for {employeeName}.
          </p>
        ) : (
          <div className="space-y-3">
            {reports.map((report) => (
              <div key={report.id} className="rounded border border-border bg-muted p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium">
                        {DISCIPLINARY_ACTION_LABELS[report.actionType as keyof typeof DISCIPLINARY_ACTION_LABELS] ?? report.actionType}
                      </p>
                      {report.acknowledgedAt ? (
                        <Badge variant="success" className="gap-1 text-xs">
                          <CheckCircle2 className="h-3 w-3" />
                          Acknowledged {format(new Date(report.acknowledgedAt), "MMM d, yyyy")}
                        </Badge>
                      ) : (
                        <Badge variant="warning" className="text-xs">Awaiting signature</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Incident {formatCalendarDate(report.incidentDate, "MMM d, yyyy")} · issued by{" "}
                      {report.issuedByName} on {format(new Date(report.createdAt), "MMM d, yyyy")}
                      {report.followUpDate &&
                        ` · follow-up ${formatCalendarDate(report.followUpDate, "MMM d, yyyy")}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <a
                      href={`/api/team/disciplinary/${report.id}/pdf`}
                      className="rounded p-1.5 text-muted-foreground hover:text-foreground"
                      aria-label="Export PDF"
                      title="Export PDF"
                    >
                      <FileDown className="h-4 w-4" />
                    </a>
                    <button
                      onClick={() => setEditReport(report)}
                      className="rounded p-1.5 text-muted-foreground hover:text-foreground"
                      aria-label="Edit report"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    {isAdmin && (
                      <button
                        onClick={() => handleDelete(report)}
                        className="rounded p-1.5 text-muted-foreground hover:text-destructive"
                        aria-label="Delete report"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-sm mt-2 whitespace-pre-wrap line-clamp-3">{report.description}</p>
                <button
                  onClick={() => toggleAcknowledged(report)}
                  className="mt-2 text-xs text-primary hover:underline"
                >
                  {report.acknowledgedAt ? "Clear acknowledgement" : "Mark acknowledged (signed copy received)"}
                </button>
              </div>
            ))}
          </div>
        )}

        <FormDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          title={`New disciplinary report — ${employeeName}`}
          action={createDisciplinaryReport}
          submitLabel="Create report"
        >
          {({ fieldErrors }) => formFields(null, fieldErrors)}
        </FormDialog>

        {editReport && (
          <FormDialog
            open={!!editReport}
            onClose={() => setEditReport(null)}
            title="Edit disciplinary report"
            action={updateDisciplinaryReport}
            submitLabel="Save changes"
          >
            {({ fieldErrors }) => formFields(editReport, fieldErrors)}
          </FormDialog>
        )}
        <ConfirmDialog />
      </CardContent>
    </Card>
  );
}
