"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormDialog } from "@/components/shared/form-dialog";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import {
  linkSubcontractorProject,
  updateSubcontractorProject,
  unlinkSubcontractorProject,
} from "@/actions/subcontractors";
import { Plus, Pencil, X, HardHat } from "lucide-react";

interface ProjectSubLink {
  id: string;
  subcontractorId: string;
  subcontractorName: string;
  subcontractorPreferred: boolean;
  scope: string | null;
  role: string | null;
  status: string;
  startDate: Date | null;
  endDate: Date | null;
  contractValue: number | null;
  currency: string | null;
  rate: number | null;
  rateUnit: string | null;
  notes: string | null;
}

interface Props {
  projectId: string;
  links: ProjectSubLink[];
  allSubcontractors: { id: string; name: string }[];
  canEdit: boolean;
}

const STATUS_OPTIONS = [
  { label: "Active", value: "ACTIVE" },
  { label: "Planned", value: "PLANNED" },
  { label: "Completed", value: "COMPLETED" },
  { label: "On Hold", value: "ON_HOLD" },
  { label: "Terminated", value: "TERMINATED" },
];

const RATE_UNIT_OPTIONS = [
  { label: "Hour", value: "hour" },
  { label: "Day", value: "day" },
  { label: "Project", value: "project" },
  { label: "Fixed", value: "fixed" },
];

function isoDate(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

const fmtCurrency = (n: number, currency = "USD") =>
  n.toLocaleString("en-US", { style: "currency", currency, minimumFractionDigits: 0 });

export function ProjectSubcontractorsCard({ projectId, links, allSubcontractors, canEdit }: Props) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [editLink, setEditLink] = useState<ProjectSubLink | null>(null);
  const router = useRouter();

  const linkedIds = new Set(links.map((l) => l.subcontractorId));
  const available = allSubcontractors.filter((s) => !linkedIds.has(s.id));

  const totalActive = links
    .filter((l) => l.status === "ACTIVE" || l.status === "PLANNED")
    .reduce((acc, l) => acc + (l.contractValue || 0), 0);

  async function handleUnlink(id: string) {
    const fd = new FormData();
    fd.set("id", id);
    await unlinkSubcontractorProject(null, fd);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {totalActive > 0 && (
        <p className="text-xs text-muted-foreground">
          Active value: <span className="font-medium text-foreground">{fmtCurrency(totalActive)}</span>
        </p>
      )}

      {links.length === 0 && (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <HardHat className="h-4 w-4" /> No subcontractors assigned
        </p>
      )}

      {links.map((l) => (
        <div key={l.id} className="rounded border border-border bg-muted p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <Link
                  href={`/subcontractors/${l.subcontractorId}`}
                  className="text-sm font-medium hover:text-primary hover:underline"
                >
                  {l.subcontractorName}
                </Link>
                <StatusBadge status={l.status} />
                {l.role && <Badge variant="outline">{l.role}</Badge>}
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                {l.contractValue != null && (
                  <span>{fmtCurrency(l.contractValue, l.currency || "USD")}</span>
                )}
                {l.rate != null && (
                  <span>
                    {fmtCurrency(l.rate, l.currency || "USD")}
                    {l.rateUnit ? ` / ${l.rateUnit}` : ""}
                  </span>
                )}
                {(l.startDate || l.endDate) && (
                  <span>
                    {l.startDate ? format(l.startDate, "MMM d, yyyy") : "—"}
                    {l.endDate ? ` to ${format(l.endDate, "MMM d, yyyy")}` : ""}
                  </span>
                )}
              </div>
              {l.scope && <p className="mt-2 text-xs text-muted-foreground whitespace-pre-wrap">{l.scope}</p>}
            </div>
            {canEdit && (
              <div className="flex gap-1 shrink-0">
                <button onClick={() => setEditLink(l)} className="rounded p-1 text-muted-foreground hover:text-foreground">
                  <Pencil className="h-3 w-3" />
                </button>
                <button onClick={() => handleUnlink(l.id)} className="rounded p-1 text-muted-foreground hover:text-destructive">
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
        </div>
      ))}

      {canEdit && available.length > 0 && (
        <>
          <Button variant="outline" size="sm" className="w-full" onClick={() => setLinkOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Assign Subcontractor
          </Button>
          <FormDialog
            open={linkOpen}
            onClose={() => setLinkOpen(false)}
            title="Assign Subcontractor"
            action={linkSubcontractorProject}
            submitLabel="Assign"
          >
            {() => (
              <>
                <input type="hidden" name="projectId" value={projectId} />
                <Select
                  name="subcontractorId"
                  label="Subcontractor"
                  options={available.map((s) => ({ label: s.name, value: s.id }))}
                  placeholder="Select subcontractor"
                  required
                />
                <Input name="role" label="Role" placeholder="e.g. Lead Developer" />
                <Select name="status" label="Status" options={STATUS_OPTIONS} defaultValue="ACTIVE" />
                <Textarea name="scope" label="Scope of Work" />
                <div className="grid grid-cols-2 gap-4">
                  <Input name="startDate" label="Start Date" type="date" />
                  <Input name="endDate" label="End Date" type="date" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Input name="contractValue" label="Contract Value" type="number" step="0.01" />
                  <Input name="rate" label="Rate" type="number" step="0.01" />
                </div>
                <Select name="rateUnit" label="Rate Unit" options={RATE_UNIT_OPTIONS} placeholder="Select" />
                <Textarea name="notes" label="Notes" />
              </>
            )}
          </FormDialog>
        </>
      )}
      {canEdit && available.length === 0 && allSubcontractors.length === 0 && (
        <Link href="/subcontractors" className="text-xs text-primary hover:underline">
          + Create subcontractor first
        </Link>
      )}

      {editLink && (
        <FormDialog
          open={!!editLink}
          onClose={() => setEditLink(null)}
          title={`Edit: ${editLink.subcontractorName}`}
          action={updateSubcontractorProject}
        >
          {() => (
            <>
              <input type="hidden" name="id" value={editLink.id} />
              <Input name="role" label="Role" defaultValue={editLink.role || ""} />
              <Select name="status" label="Status" options={STATUS_OPTIONS} defaultValue={editLink.status} />
              <Textarea name="scope" label="Scope of Work" defaultValue={editLink.scope || ""} />
              <div className="grid grid-cols-2 gap-4">
                <Input name="startDate" label="Start Date" type="date" defaultValue={isoDate(editLink.startDate)} />
                <Input name="endDate" label="End Date" type="date" defaultValue={isoDate(editLink.endDate)} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Input
                  name="contractValue"
                  label="Contract Value"
                  type="number"
                  step="0.01"
                  defaultValue={editLink.contractValue?.toString() || ""}
                />
                <Input
                  name="rate"
                  label="Rate"
                  type="number"
                  step="0.01"
                  defaultValue={editLink.rate?.toString() || ""}
                />
              </div>
              <Select name="rateUnit" label="Rate Unit" options={RATE_UNIT_OPTIONS} defaultValue={editLink.rateUnit || ""} placeholder="Select" />
              <Textarea name="notes" label="Notes" defaultValue={editLink.notes || ""} />
            </>
          )}
        </FormDialog>
      )}
    </div>
  );
}
