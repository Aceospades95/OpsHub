"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { FormDialog } from "@/components/shared/form-dialog";
import { createPartnership } from "@/actions/partnerships";
import { Plus } from "lucide-react";

const TYPE_OPTIONS = [
  { label: "Strategic", value: "STRATEGIC" },
  { label: "Referral", value: "REFERRAL" },
  { label: "Reseller", value: "RESELLER" },
  { label: "Technology", value: "TECHNOLOGY" },
  { label: "Channel", value: "CHANNEL" },
  { label: "Joint Venture", value: "JOINT_VENTURE" },
  { label: "Affiliate", value: "AFFILIATE" },
  { label: "Other", value: "OTHER" },
];

const STATUS_OPTIONS = [
  { label: "Active", value: "ACTIVE" },
  { label: "Prospect", value: "PROSPECT" },
  { label: "Paused", value: "PAUSED" },
  { label: "Inactive", value: "INACTIVE" },
  { label: "Archived", value: "ARCHIVED" },
];

const TIER_OPTIONS = [
  { label: "—", value: "" },
  { label: "Platinum", value: "PLATINUM" },
  { label: "Gold", value: "GOLD" },
  { label: "Silver", value: "SILVER" },
  { label: "Bronze", value: "BRONZE" },
  { label: "Standard", value: "STANDARD" },
];

export function PartnershipCreateButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm">
        <Plus className="h-4 w-4 mr-1" /> New Partnership
      </Button>
      <FormDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Create Partnership"
        action={createPartnership}
        submitLabel="Create"
      >
        {({ fieldErrors }) => (
          <>
            <Input name="name" label="Partner Name" required error={fieldErrors?.name?.[0]} />
            <Input name="legalName" label="Legal Entity Name" placeholder="If different from name" />
            <div className="grid grid-cols-2 gap-4">
              <Select name="type" label="Type" options={TYPE_OPTIONS} defaultValue="STRATEGIC" />
              <Select name="status" label="Status" options={STATUS_OPTIONS} defaultValue="ACTIVE" />
            </div>
            <Select name="tier" label="Tier" options={TIER_OPTIONS} defaultValue="" />
            <Input name="industry" label="Industry" />
            <Textarea name="description" label="Description" />

            <div className="border-t border-border pt-3 mt-2">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Primary Contact</h4>
              <Input name="primaryContactName" label="Contact Name" />
              <Input name="primaryContactEmail" label="Contact Email" type="email" />
              <Input name="primaryContactPhone" label="Contact Phone" />
              <Input name="website" label="Website" />
            </div>

            <div className="border-t border-border pt-3 mt-2">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Agreement</h4>
              <div className="grid grid-cols-2 gap-4">
                <Input name="partnerSinceDate" label="Partner Since" type="date" />
                <Input name="agreementSignedAt" label="Agreement Signed" type="date" />
              </div>
              <Input name="agreementExpiresAt" label="Agreement Expires" type="date" />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="autoRenew" value="true" className="rounded" />
                Auto-renew
              </label>
            </div>

            <div className="border-t border-border pt-3 mt-2">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Commercial</h4>
              <Input name="referralFeePercent" label="Referral Fee (%)" type="number" step="0.01" placeholder="e.g. 20" />
              <Textarea name="revenueShareTerms" label="Revenue Share Terms" placeholder="Free-form description of commercial terms" />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="jointMarketing" value="true" className="rounded" />
                Joint marketing
              </label>
            </div>
          </>
        )}
      </FormDialog>
    </>
  );
}
