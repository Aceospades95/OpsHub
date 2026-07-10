"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { FormDialog } from "@/components/shared/form-dialog";
import { toCalendarDateString } from "@/lib/dates";
import { createBid } from "@/actions/bids";
import { BID_STATUSES, BID_STATUS_LABELS } from "@/lib/bids";
import { Plus } from "lucide-react";

export const BID_STATUS_OPTIONS = BID_STATUSES.map((s) => ({
  value: s,
  label: BID_STATUS_LABELS[s],
}));

export interface BidOption {
  id: string;
  name: string;
}

/** Shared field set for the create + edit dialogs. */
export function BidFields({
  bid,
  portals,
  clients,
  users,
  fieldErrors,
}: {
  bid?: {
    title: string;
    solicitationNumber: string | null;
    agency: string | null;
    url: string | null;
    description: string | null;
    estimatedValue: number | null;
    status: string;
    dueDate: string | null;
    portalId: string | null;
    clientId: string | null;
    ownerId: string | null;
    lossReason: string | null;
    notes: string | null;
  };
  portals: BidOption[];
  clients: BidOption[];
  users: BidOption[];
  fieldErrors?: Record<string, string[] | undefined>;
}) {
  return (
    <>
      <Input name="title" label="Title" required defaultValue={bid?.title ?? ""} error={fieldErrors?.title?.[0]} />
      <div className="grid grid-cols-2 gap-4">
        <Input
          name="agency"
          label="Agency / buyer"
          placeholder='e.g. "City of Chicago DoIT"'
          defaultValue={bid?.agency ?? ""}
        />
        <Input
          name="solicitationNumber"
          label="Solicitation #"
          placeholder="RFP/RFQ number"
          defaultValue={bid?.solicitationNumber ?? ""}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Select
          name="portalId"
          label="Found via portal"
          defaultValue={bid?.portalId ?? ""}
          options={[{ label: "None / referral", value: "" }, ...portals.map((p) => ({ label: p.name, value: p.id }))]}
        />
        <Input name="url" label="Solicitation URL" placeholder="https://…" defaultValue={bid?.url ?? ""} error={fieldErrors?.url?.[0]} />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <Select name="status" label="Stage" defaultValue={bid?.status ?? "IDENTIFIED"} options={BID_STATUS_OPTIONS} />
        <Input
          name="estimatedValue"
          label="Est. value ($)"
          type="number"
          step="0.01"
          defaultValue={bid?.estimatedValue != null ? String(bid.estimatedValue) : ""}
        />
        <Input
          name="dueDate"
          label="Response due"
          type="date"
          defaultValue={toCalendarDateString(bid?.dueDate)}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Select
          name="clientId"
          label="Client (if existing)"
          defaultValue={bid?.clientId ?? ""}
          options={[{ label: "None yet", value: "" }, ...clients.map((c) => ({ label: c.name, value: c.id }))]}
        />
        <Select
          name="ownerId"
          label="Owner"
          defaultValue={bid?.ownerId ?? ""}
          options={[{ label: "Unassigned", value: "" }, ...users.map((u) => ({ label: u.name, value: u.id }))]}
        />
      </div>
      <Textarea name="description" label="Scope / summary" rows={3} defaultValue={bid?.description ?? ""} />
      {bid && (
        <Input
          name="lossReason"
          label="Loss reason (for Not Awarded / No Bid)"
          defaultValue={bid?.lossReason ?? ""}
        />
      )}
      <Textarea name="notes" label="Notes" rows={2} defaultValue={bid?.notes ?? ""} />
    </>
  );
}

export function BidCreateButton({
  portals,
  clients,
  users,
}: {
  portals: BidOption[];
  clients: BidOption[];
  users: BidOption[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm">
        <Plus className="h-4 w-4 mr-1" /> Add Bid
      </Button>
      <FormDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Add bid opportunity"
        action={createBid}
        submitLabel="Add bid"
      >
        {({ fieldErrors }) => (
          <BidFields portals={portals} clients={clients} users={users} fieldErrors={fieldErrors} />
        )}
      </FormDialog>
    </>
  );
}
