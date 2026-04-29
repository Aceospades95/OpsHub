"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { FormDialog } from "@/components/shared/form-dialog";
import { createSubcontractor } from "@/actions/subcontractors";
import { Plus } from "lucide-react";

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

export function SubcontractorCreateButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm">
        <Plus className="h-4 w-4 mr-1" /> New Subcontractor
      </Button>
      <FormDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Create Subcontractor"
        action={createSubcontractor}
        submitLabel="Create"
      >
        {({ fieldErrors }) => (
          <>
            <Input name="name" label="Name" required error={fieldErrors?.name?.[0]} />
            <Input name="legalName" label="Legal Entity Name" placeholder="If different from name" />
            <div className="grid grid-cols-2 gap-4">
              <Select name="type" label="Type" options={TYPE_OPTIONS} defaultValue="COMPANY" />
              <Select name="status" label="Status" options={STATUS_OPTIONS} defaultValue="ACTIVE" />
            </div>
            <Textarea name="description" label="Description" />
            <Input name="specialties" label="Specialties" placeholder="Comma-separated, e.g. cloud, frontend, devops" />

            <div className="border-t border-border pt-3 mt-2">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Primary Contact</h4>
              <Input name="primaryContactName" label="Contact Name" />
              <Input name="primaryContactEmail" label="Contact Email" type="email" />
              <Input name="primaryContactPhone" label="Contact Phone" />
              <Input name="website" label="Website" />
            </div>

            <div className="border-t border-border pt-3 mt-2">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Financial</h4>
              <div className="grid grid-cols-2 gap-4">
                <Input name="defaultRate" label="Default Rate" type="number" step="0.01" />
                <Select name="rateUnit" label="Rate Unit" options={RATE_UNIT_OPTIONS} placeholder="Select" />
              </div>
              <Input name="paymentTerms" label="Payment Terms" placeholder="e.g. Net 30" />
            </div>

            <div className="border-t border-border pt-3 mt-2">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Compliance</h4>
              <Select name="complianceStatus" label="Compliance Status" options={COMPLIANCE_OPTIONS} defaultValue="PENDING" />
              <Input name="insuranceExpiresAt" label="Insurance Expires" type="date" />
              <div className="grid grid-cols-2 gap-4">
                <Input name="msaSignedAt" label="MSA Signed" type="date" />
                <Input name="ndaSignedAt" label="NDA Signed" type="date" />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="w9OnFile" value="true" className="rounded" />
                W-9 on file
              </label>
            </div>

            <label className="flex items-center gap-2 text-sm pt-2">
              <input type="checkbox" name="isPreferred" value="true" className="rounded" />
              Preferred subcontractor
            </label>
          </>
        )}
      </FormDialog>
    </>
  );
}
