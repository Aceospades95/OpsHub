"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/shared/form-dialog";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { updateBid, deleteBid } from "@/actions/bids";
import { BidFields, type BidOption } from "../bid-create-button";
import { Pencil, Trash2 } from "lucide-react";

export function BidActions({
  bid,
  portals,
  clients,
  users,
  contracts,
  canEdit,
  canDelete,
}: {
  bid: {
    id: string;
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
    incumbent: string | null;
    endClientId: string | null;
    contractId: string | null;
    notes: string | null;
    sourceNotes: string | null;
    openQuestions: string | null;
  };
  portals: BidOption[];
  clients: BidOption[];
  users: BidOption[];
  /** Contract picker options, pre-filtered to the bid's client. */
  contracts: BidOption[];
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  async function runDelete() {
    const fd = new FormData();
    fd.set("id", bid.id);
    return deleteBid(null, fd);
  }

  if (!canEdit && !canDelete) return null;

  return (
    <div className="flex items-center gap-2">
      {canEdit && (
        <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
          <Pencil className="h-4 w-4 mr-1" /> Edit
        </Button>
      )}
      {canDelete && (
        <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
          <Trash2 className="h-4 w-4 mr-1" /> Delete
        </Button>
      )}

      {canEdit && (
        <FormDialog
          open={editOpen}
          onClose={() => setEditOpen(false)}
          title="Edit bid"
          action={updateBid}
          submitLabel="Save changes"
        >
          {({ fieldErrors }) => (
            <>
              <input type="hidden" name="id" value={bid.id} />
              <BidFields
                bid={bid}
                portals={portals}
                clients={clients}
                users={users}
                contracts={contracts}
                fieldErrors={fieldErrors}
              />
            </>
          )}
        </FormDialog>
      )}

      {canDelete && (
        <ConfirmDialog
          open={deleteOpen}
          onClose={() => setDeleteOpen(false)}
          title="Delete bid"
          message="The bid moves to the recovery bin for 30 days, then is purged."
          confirmLabel="Delete"
          onConfirm={runDelete}
          navigateTo="/bids"
          successToast="Bid deleted"
        />
      )}
    </div>
  );
}
