"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { FormDialog } from "@/components/shared/form-dialog";
import { Dialog } from "@/components/ui/dialog";
import { updateSubcontractor, deleteSubcontractor } from "@/actions/subcontractors";
import { Pencil, Trash2 } from "lucide-react";

interface Subcontractor {
  id: string;
  name: string;
  legalName: string | null;
  type: string;
  status: string;
  description: string | null;
  summary: string | null;
  specialties: string[];
  primaryContactName: string | null;
  primaryContactEmail: string | null;
  primaryContactPhone: string | null;
  website: string | null;
  address: string | null;
  taxId: string | null;
  businessLicense: string | null;
  defaultRate: number | null;
  rateUnit: string | null;
  currency: string | null;
  paymentTerms: string | null;
  insuranceExpiresAt: Date | null;
  w9OnFile: boolean;
  msaSignedAt: Date | null;
  ndaSignedAt: Date | null;
  complianceStatus: string;
  complianceNotes: string | null;
  rating: number | null;
  isPreferred: boolean;
  accountManagerId: string | null;
  notes: string | null;
}

interface Props {
  subcontractor: Subcontractor;
  users: { id: string; name: string }[];
  canEdit: boolean;
  canDelete: boolean;
}

const TYPE_OPTIONS = [
  { label: "Company", value: "COMPANY" },
  { label: "Individual (1099)", value: "INDIVIDUAL" },
  { label: "Staffing Agency", value: "AGENCY" },
];

const STATUS_OPTIONS = [
  { label: "Active", value: "ACTIVE" },
  { label: "Onboarding", value: "ONBOARDING" },
  { label: "Inactive", value: "INACTIVE" },
  { label: "Suspended", value: "SUSPENDED" },
  { label: "Archived", value: "ARCHIVED" },
];

const COMPLIANCE_OPTIONS = [
  { label: "Pending", value: "PENDING" },
  { label: "Compliant", value: "COMPLIANT" },
  { label: "Expired", value: "EXPIRED" },
  { label: "Non-compliant", value: "NON_COMPLIANT" },
];

const RATE_UNIT_OPTIONS = [
  { label: "Hour", value: "hour" },
  { label: "Day", value: "day" },
  { label: "Project", value: "project" },
  { label: "Fixed", value: "fixed" },
];

function isoDate(d: Date | null): string {
  if (!d) return "";
  return d.toISOString().slice(0, 10);
}

export function SubcontractorActions({ subcontractor, users, canEdit, canDelete }: Props) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const router = useRouter();

  async function handleDelete() {
    const fd = new FormData();
    fd.set("id", subcontractor.id);
    const result = await deleteSubcontractor(null, fd);
    if (result.success) router.push("/subcontractors");
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
            title="Edit Subcontractor"
            action={updateSubcontractor}
          >
            {({ fieldErrors }) => (
              <>
                <input type="hidden" name="id" value={subcontractor.id} />
                <Input name="name" label="Name" defaultValue={subcontractor.name} required error={fieldErrors?.name?.[0]} />
                <Input name="legalName" label="Legal Entity Name" defaultValue={subcontractor.legalName || ""} />
                <div className="grid grid-cols-2 gap-4">
                  <Select name="type" label="Type" options={TYPE_OPTIONS} defaultValue={subcontractor.type} />
                  <Select name="status" label="Status" options={STATUS_OPTIONS} defaultValue={subcontractor.status} />
                </div>
                <Textarea name="description" label="Description" defaultValue={subcontractor.description || ""} />
                <Textarea name="summary" label="Summary" defaultValue={subcontractor.summary || ""} />
                <Input
                  name="specialties"
                  label="Specialties"
                  placeholder="Comma-separated"
                  defaultValue={subcontractor.specialties.join(", ")}
                />
                <Select
                  name="accountManagerId"
                  label="Account Manager"
                  options={users.map((u) => ({ label: u.name, value: u.id }))}
                  defaultValue={subcontractor.accountManagerId || ""}
                  placeholder="Unassigned"
                />

                <div className="border-t border-border pt-3 mt-2">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Primary Contact</h4>
                  <Input name="primaryContactName" label="Contact Name" defaultValue={subcontractor.primaryContactName || ""} />
                  <Input name="primaryContactEmail" label="Contact Email" type="email" defaultValue={subcontractor.primaryContactEmail || ""} />
                  <Input name="primaryContactPhone" label="Contact Phone" defaultValue={subcontractor.primaryContactPhone || ""} />
                  <Input name="website" label="Website" defaultValue={subcontractor.website || ""} />
                  <Textarea name="address" label="Address" defaultValue={subcontractor.address || ""} />
                </div>

                <div className="border-t border-border pt-3 mt-2">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Business</h4>
                  <Input name="taxId" label="Tax ID (EIN/SSN)" defaultValue={subcontractor.taxId || ""} />
                  <Input name="businessLicense" label="Business License" defaultValue={subcontractor.businessLicense || ""} />
                </div>

                <div className="border-t border-border pt-3 mt-2">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Financial</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <Input
                      name="defaultRate"
                      label="Default Rate"
                      type="number"
                      step="0.01"
                      defaultValue={subcontractor.defaultRate?.toString() || ""}
                    />
                    <Select name="rateUnit" label="Rate Unit" options={RATE_UNIT_OPTIONS} defaultValue={subcontractor.rateUnit || ""} placeholder="Select" />
                  </div>
                  <Input name="paymentTerms" label="Payment Terms" defaultValue={subcontractor.paymentTerms || ""} />
                </div>

                <div className="border-t border-border pt-3 mt-2">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Compliance</h4>
                  <Select name="complianceStatus" label="Compliance Status" options={COMPLIANCE_OPTIONS} defaultValue={subcontractor.complianceStatus} />
                  <Input name="insuranceExpiresAt" label="Insurance Expires" type="date" defaultValue={isoDate(subcontractor.insuranceExpiresAt)} />
                  <div className="grid grid-cols-2 gap-4">
                    <Input name="msaSignedAt" label="MSA Signed" type="date" defaultValue={isoDate(subcontractor.msaSignedAt)} />
                    <Input name="ndaSignedAt" label="NDA Signed" type="date" defaultValue={isoDate(subcontractor.ndaSignedAt)} />
                  </div>
                  <Textarea name="complianceNotes" label="Compliance Notes" defaultValue={subcontractor.complianceNotes || ""} />
                  <label className="flex items-center gap-2 text-sm pt-2">
                    <input type="checkbox" name="w9OnFile" value="true" defaultChecked={subcontractor.w9OnFile} className="rounded" />
                    W-9 on file
                  </label>
                </div>

                <Input
                  name="rating"
                  label="Rating (1-5)"
                  type="number"
                  step="0.1"
                  min="1"
                  max="5"
                  defaultValue={subcontractor.rating?.toString() || ""}
                />
                <Textarea name="notes" label="Internal Notes" defaultValue={subcontractor.notes || ""} />

                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="isPreferred" value="true" defaultChecked={subcontractor.isPreferred} className="rounded" />
                  Preferred subcontractor
                </label>
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
          <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete Subcontractor">
            <p className="text-sm text-muted-foreground mb-4">
              Delete <strong>{subcontractor.name}</strong>? Project links, contacts, and attachments will be removed.
            </p>
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
