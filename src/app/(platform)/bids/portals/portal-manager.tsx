"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { FormDialog } from "@/components/shared/form-dialog";
import { useConfirm } from "@/components/shared/use-confirm";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toCalendarDateString } from "@/lib/dates";
import { createBidPortal, updateBidPortal, deleteBidPortal } from "@/actions/bids";
import { Plus, Pencil, Trash2 } from "lucide-react";

export interface PortalRow {
  id: string;
  name: string;
  url: string | null;
  jurisdiction: string | null;
  accountIdentifier: string | null;
  /** ISO string or null — serialized server-side. */
  registrationRenewsAt: string | null;
  isActive: boolean;
  notes: string | null;
  bidCount: number;
}

function PortalFields({
  portal,
  fieldErrors,
}: {
  portal?: PortalRow;
  fieldErrors?: Record<string, string[] | undefined>;
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <Input name="name" label="Name" required defaultValue={portal?.name ?? ""} error={fieldErrors?.name?.[0]} />
        <Input
          name="jurisdiction"
          label="Jurisdiction"
          placeholder='e.g. "City of Chicago"'
          defaultValue={portal?.jurisdiction ?? ""}
        />
      </div>
      <Input name="url" label="URL" placeholder="https://…" defaultValue={portal?.url ?? ""} error={fieldErrors?.url?.[0]} />
      <div className="grid grid-cols-2 gap-4">
        <Input
          name="accountIdentifier"
          label="Account (email / username)"
          placeholder="Who we're registered as — never a password"
          defaultValue={portal?.accountIdentifier ?? ""}
        />
        <Input
          name="registrationRenewsAt"
          label="Registration renews"
          type="date"
          defaultValue={toCalendarDateString(portal?.registrationRenewsAt)}
        />
      </div>
      <Select
        name="isActive"
        label="Status"
        defaultValue={portal ? String(portal.isActive) : "true"}
        options={[
          { label: "Active — checking for opportunities", value: "true" },
          { label: "Inactive", value: "false" },
        ]}
      />
      <Textarea name="notes" label="Notes" rows={2} defaultValue={portal?.notes ?? ""} />
    </>
  );
}

export function PortalCreateButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm">
        <Plus className="h-4 w-4 mr-1" /> Add Portal
      </Button>
      <FormDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Add procurement portal"
        action={createBidPortal}
        submitLabel="Add portal"
      >
        {({ fieldErrors }) => <PortalFields fieldErrors={fieldErrors} />}
      </FormDialog>
    </>
  );
}

export function PortalRowActions({
  portal,
  canEdit,
  canDelete,
}: {
  portal: PortalRow;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const { confirm, ConfirmDialog } = useConfirm();
  const [, startTransition] = useTransition();
  const router = useRouter();

  async function handleDelete() {
    const ok = await confirm({
      title: `Delete "${portal.name}"?`,
      message:
        portal.bidCount > 0
          ? `${portal.bidCount} bid${portal.bidCount === 1 ? "" : "s"} reference this portal — they keep their history, just lose the portal link.`
          : "This can't be undone.",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    const fd = new FormData();
    fd.set("id", portal.id);
    const result = await deleteBidPortal(null, fd);
    if (result && "error" in result && result.error) {
      toast.error(result.error);
      return;
    }
    toast.success("Portal deleted");
    startTransition(() => router.refresh());
  }

  if (!canEdit && !canDelete) return null;

  return (
    <div className="flex items-center justify-end gap-1">
      {canEdit && (
        <button
          onClick={() => setEditOpen(true)}
          aria-label={`Edit ${portal.name}`}
          className="rounded p-1.5 text-muted-foreground hover:text-foreground"
        >
          <Pencil className="h-4 w-4" />
        </button>
      )}
      {canDelete && (
        <button
          onClick={handleDelete}
          aria-label={`Delete ${portal.name}`}
          className="rounded p-1.5 text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
      {canEdit && (
        <FormDialog
          open={editOpen}
          onClose={() => setEditOpen(false)}
          title="Edit portal"
          action={updateBidPortal}
          submitLabel="Save changes"
        >
          {({ fieldErrors }) => (
            <>
              <input type="hidden" name="id" value={portal.id} />
              <PortalFields portal={portal} fieldErrors={fieldErrors} />
            </>
          )}
        </FormDialog>
      )}
      <ConfirmDialog />
    </div>
  );
}
