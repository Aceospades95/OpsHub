"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { FormDialog } from "@/components/shared/form-dialog";
import { Dialog } from "@/components/ui/dialog";
import { updatePartnership, deletePartnership } from "@/actions/partnerships";
import { Pencil, Trash2 } from "lucide-react";

interface Partnership {
  id: string;
  name: string;
  legalName: string | null;
  type: string;
  status: string;
  tier: string | null;
  description: string | null;
  summary: string | null;
  primaryContactName: string | null;
  primaryContactEmail: string | null;
  primaryContactPhone: string | null;
  website: string | null;
  address: string | null;
  industry: string | null;
  partnerSinceDate: Date | null;
  agreementSignedAt: Date | null;
  agreementExpiresAt: Date | null;
  autoRenew: boolean;
  revenueShareTerms: string | null;
  referralFeeBps: number | null;
  jointMarketing: boolean;
  relationshipOwnerId: string | null;
  notes: string | null;
}

interface Props {
  partnership: Partnership;
  users: { id: string; name: string }[];
  canEdit: boolean;
  canDelete: boolean;
}

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

function isoDate(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

export function PartnershipActions({ partnership, users, canEdit, canDelete }: Props) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const router = useRouter();

  async function handleDelete() {
    const fd = new FormData();
    fd.set("id", partnership.id);
    const result = await deletePartnership(null, fd);
    if (result.success) router.push("/partnerships");
  }

  const referralFeePercent =
    partnership.referralFeeBps != null ? (partnership.referralFeeBps / 100).toString() : "";

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
            title="Edit Partnership"
            action={updatePartnership}
          >
            {({ fieldErrors }) => (
              <>
                <input type="hidden" name="id" value={partnership.id} />
                <Input name="name" label="Partner Name" defaultValue={partnership.name} required error={fieldErrors?.name?.[0]} />
                <Input name="legalName" label="Legal Entity Name" defaultValue={partnership.legalName || ""} />
                <div className="grid grid-cols-2 gap-4">
                  <Select name="type" label="Type" options={TYPE_OPTIONS} defaultValue={partnership.type} />
                  <Select name="status" label="Status" options={STATUS_OPTIONS} defaultValue={partnership.status} />
                </div>
                <Select name="tier" label="Tier" options={TIER_OPTIONS} defaultValue={partnership.tier || ""} />
                <Input name="industry" label="Industry" defaultValue={partnership.industry || ""} />
                <Textarea name="description" label="Description" defaultValue={partnership.description || ""} />
                <Textarea name="summary" label="Summary" defaultValue={partnership.summary || ""} />

                <Select
                  name="relationshipOwnerId"
                  label="Relationship Owner"
                  options={users.map((u) => ({ label: u.name, value: u.id }))}
                  defaultValue={partnership.relationshipOwnerId || ""}
                  placeholder="Unassigned"
                />

                <div className="border-t border-border pt-3 mt-2">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Primary Contact</h4>
                  <Input name="primaryContactName" label="Contact Name" defaultValue={partnership.primaryContactName || ""} />
                  <Input name="primaryContactEmail" label="Contact Email" type="email" defaultValue={partnership.primaryContactEmail || ""} />
                  <Input name="primaryContactPhone" label="Contact Phone" defaultValue={partnership.primaryContactPhone || ""} />
                  <Input name="website" label="Website" defaultValue={partnership.website || ""} />
                  <Textarea name="address" label="Address" defaultValue={partnership.address || ""} />
                </div>

                <div className="border-t border-border pt-3 mt-2">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Agreement</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <Input name="partnerSinceDate" label="Partner Since" type="date" defaultValue={isoDate(partnership.partnerSinceDate)} />
                    <Input name="agreementSignedAt" label="Agreement Signed" type="date" defaultValue={isoDate(partnership.agreementSignedAt)} />
                  </div>
                  <Input name="agreementExpiresAt" label="Agreement Expires" type="date" defaultValue={isoDate(partnership.agreementExpiresAt)} />
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="autoRenew" value="true" defaultChecked={partnership.autoRenew} className="rounded" />
                    Auto-renew
                  </label>
                </div>

                <div className="border-t border-border pt-3 mt-2">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Commercial</h4>
                  <Input
                    name="referralFeePercent"
                    label="Referral Fee (%)"
                    type="number"
                    step="0.01"
                    defaultValue={referralFeePercent}
                  />
                  <Textarea name="revenueShareTerms" label="Revenue Share Terms" defaultValue={partnership.revenueShareTerms || ""} />
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="jointMarketing" value="true" defaultChecked={partnership.jointMarketing} className="rounded" />
                    Joint marketing
                  </label>
                </div>

                <Textarea name="notes" label="Internal Notes" defaultValue={partnership.notes || ""} />
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
          <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete Partnership">
            <p className="text-sm text-muted-foreground mb-4">
              Delete <strong>{partnership.name}</strong>? Project links, contacts, and attachments will be removed.
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
