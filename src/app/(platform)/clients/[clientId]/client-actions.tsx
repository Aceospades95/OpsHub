"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { FormDialog } from "@/components/shared/form-dialog";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { updateClient, deleteClient } from "@/actions/clients";
import { Pencil, Trash2 } from "lucide-react";

interface Client {
  id: string;
  name: string;
  description: string | null;
  summary: string | null;
  industry: string | null;
  website: string | null;
  status: string;
  accountManagerId: string | null;
}

interface Props {
  client: Client;
  users: { id: string; name: string }[];
  canEdit: boolean;
  canDelete: boolean;
}

export function ClientActions({ client, users, canEdit, canDelete }: Props) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  async function runDelete() {
    const fd = new FormData();
    fd.set("id", client.id);
    return deleteClient(null, fd);
  }

  return (
    <div className="flex gap-2">
      {canEdit && (
        <>
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4 mr-1" />
            Edit
          </Button>
          <FormDialog
            open={editOpen}
            onClose={() => setEditOpen(false)}
            title="Edit Client"
            action={updateClient}
          >
            {({ fieldErrors }) => (
              <>
                <input type="hidden" name="id" value={client.id} />
                <Input name="name" label="Client Name" defaultValue={client.name} required error={fieldErrors?.name?.[0]} />
                <Input name="industry" label="Industry" defaultValue={client.industry || ""} />
                <Input name="website" label="Website" defaultValue={client.website || ""} />
                <Textarea name="description" label="Description" defaultValue={client.description || ""} />
                <Textarea name="summary" label="Summary" defaultValue={client.summary || ""} />
                <Select
                  name="status"
                  label="Status"
                  defaultValue={client.status}
                  options={[
                    { label: "Active", value: "ACTIVE" },
                    { label: "Prospect", value: "PROSPECT" },
                    { label: "Inactive", value: "INACTIVE" },
                    { label: "Archived", value: "ARCHIVED" },
                  ]}
                />
                <Select
                  name="accountManagerId"
                  label="Account Manager"
                  defaultValue={client.accountManagerId || ""}
                  placeholder="No account manager"
                  options={users.map((u) => ({ label: u.name || u.id, value: u.id }))}
                />
              </>
            )}
          </FormDialog>
        </>
      )}

      {canDelete && (
        <>
          <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-4 w-4 mr-1" />
            Delete
          </Button>
          <ConfirmDialog
            open={deleteOpen}
            onClose={() => setDeleteOpen(false)}
            title="Delete Client"
            message={
              <>
                Are you sure you want to delete <strong>{client.name}</strong>?
                This will also delete all associated projects, contracts, and contacts.
              </>
            }
            onConfirm={runDelete}
            navigateTo="/clients"
            confirmLabel="Delete"
            successToast="Client deleted"
          />
        </>
      )}
    </div>
  );
}
