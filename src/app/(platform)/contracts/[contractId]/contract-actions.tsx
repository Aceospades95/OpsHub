"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { FormDialog } from "@/components/shared/form-dialog";
import { Dialog } from "@/components/ui/dialog";
import { updateContract, deleteContract } from "@/actions/contracts";
import { Pencil, Trash2 } from "lucide-react";

interface Props {
  contract: {
    id: string;
    title: string;
    description: string | null;
    status: string;
    contractNumber: string | null;
    contractType: string | null;
    value: number | null;
    currency: string | null;
    startDate: Date | null;
    endDate: Date | null;
    renewalDate: Date | null;
    noticePeriodDays: number | null;
    autoRenew: boolean;
    summary: string | null;
    externalDocumentUrl: string | null;
    documentSourceType: string | null;
    documentSourceLabel: string | null;
    parentContractId: string | null;
    clientId: string;
    projectId: string | null;
  };
  clients: { id: string; name: string }[];
  projects: { id: string; name: string }[];
  allContracts: { id: string; title: string }[];
  canEdit: boolean;
  canDelete: boolean;
}

export function ContractActions({ contract, clients, projects, allContracts, canEdit, canDelete }: Props) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const router = useRouter();

  async function handleDelete() {
    const fd = new FormData();
    fd.set("id", contract.id);
    const result = await deleteContract(null, fd);
    if (result.success) router.push("/contracts");
  }

  const fmtDate = (d: Date | null) => d?.toISOString().split("T")[0] || "";

  return (
    <div className="flex gap-2">
      {canEdit && (
        <>
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4 mr-1" /> Edit
          </Button>
          <FormDialog open={editOpen} onClose={() => setEditOpen(false)} title="Edit Contract" action={updateContract}>
            {({ fieldErrors }) => (
              <>
                <input type="hidden" name="id" value={contract.id} />
                <Input name="title" label="Title" defaultValue={contract.title} required error={fieldErrors?.title?.[0]} />
                <Input name="contractNumber" label="Contract Number" defaultValue={contract.contractNumber || ""} />
                <Select name="clientId" label="Client" defaultValue={contract.clientId} options={clients.map(c => ({ label: c.name, value: c.id }))} />
                <Select name="projectId" label="Project" defaultValue={contract.projectId || ""} options={projects.map(p => ({ label: p.name, value: p.id }))} placeholder="None" />
                <Select name="contractType" label="Type" defaultValue={contract.contractType || ""} options={[{label:"MSA",value:"MSA"},{label:"SOW",value:"SOW"},{label:"NDA",value:"NDA"},{label:"Amendment",value:"Amendment"},{label:"Other",value:"Other"}]} placeholder="Select type" />
                <Select name="status" label="Status" defaultValue={contract.status} options={[{label:"Draft",value:"DRAFT"},{label:"Under Review",value:"UNDER_REVIEW"},{label:"Active",value:"ACTIVE"},{label:"Expiring Soon",value:"EXPIRING_SOON"},{label:"Expired",value:"EXPIRED"},{label:"Terminated",value:"TERMINATED"},{label:"Renewed",value:"RENEWED"}]} />
                <div className="grid grid-cols-2 gap-4">
                  <Input name="value" label="Value" type="number" step="0.01" defaultValue={contract.value?.toString() || ""} />
                  <Input name="currency" label="Currency" defaultValue={contract.currency || "USD"} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Input name="startDate" label="Start Date" type="date" defaultValue={fmtDate(contract.startDate)} />
                  <Input name="endDate" label="End Date" type="date" defaultValue={fmtDate(contract.endDate)} />
                </div>
                <Input name="renewalDate" label="Renewal Date" type="date" defaultValue={fmtDate(contract.renewalDate)} />
                <div className="grid grid-cols-2 gap-4">
                  <Input name="noticePeriodDays" label="Notice Period (days)" type="number" defaultValue={contract.noticePeriodDays?.toString() || ""} />
                  <div className="flex items-end pb-1">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="autoRenew" value="true" defaultChecked={contract.autoRenew} className="rounded" />
                      Auto-Renew
                    </label>
                  </div>
                </div>
                <Textarea name="summary" label="Summary" defaultValue={contract.summary || ""} />
                <Textarea name="description" label="Description" defaultValue={contract.description || ""} />
                <Input name="externalDocumentUrl" label="Document URL" defaultValue={contract.externalDocumentUrl || ""} />
                <Select name="documentSourceType" label="Document Source" defaultValue={contract.documentSourceType || ""} options={[{label:"Upload",value:"upload"},{label:"Google Drive",value:"google_drive"},{label:"External URL",value:"external_url"},{label:"Other",value:"other"}]} placeholder="Select" />
                <Select name="parentContractId" label="Parent Contract" defaultValue={contract.parentContractId || ""} options={allContracts.map(c => ({ label: c.title, value: c.id }))} placeholder="None" />
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
          <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete Contract">
            <p className="text-sm text-muted-foreground mb-4">Delete <strong>{contract.title}</strong>?</p>
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
