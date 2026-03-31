"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { FormDialog } from "@/components/shared/form-dialog";
import { createContract } from "@/actions/contracts";
import { Plus } from "lucide-react";

interface Props {
  clients: { id: string; name: string }[];
  projects: { id: string; name: string }[];
  parentContracts: { id: string; title: string }[];
  defaultClientId?: string;
  defaultParentId?: string;
}

export function ContractCreateButton({ clients, projects, parentContracts, defaultClientId, defaultParentId }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm">
        <Plus className="h-4 w-4 mr-1" />
        {defaultParentId ? "New Child Contract" : "New Contract"}
      </Button>
      <FormDialog
        open={open}
        onClose={() => setOpen(false)}
        title={defaultParentId ? "Create Child Contract" : "Create Contract"}
        action={createContract}
        submitLabel="Create Contract"
      >
        {({ fieldErrors }) => (
          <>
            {defaultParentId && <input type="hidden" name="parentContractId" value={defaultParentId} />}
            <Input name="title" label="Title" required error={fieldErrors?.title?.[0]} />
            <Input name="contractNumber" label="Contract Number" />
            <Select
              name="clientId"
              label="Client"
              defaultValue={defaultClientId || ""}
              options={clients.map((c) => ({ label: c.name, value: c.id }))}
              placeholder="Select client"
              required
            />
            <Select
              name="projectId"
              label="Project (optional)"
              options={projects.map((p) => ({ label: p.name, value: p.id }))}
              placeholder="None"
            />
            <Select
              name="contractType"
              label="Type"
              options={[
                { label: "MSA", value: "MSA" },
                { label: "SOW", value: "SOW" },
                { label: "NDA", value: "NDA" },
                { label: "Amendment", value: "Amendment" },
                { label: "Other", value: "Other" },
              ]}
              placeholder="Select type"
            />
            <Select
              name="status"
              label="Status"
              options={[
                { label: "Draft", value: "DRAFT" },
                { label: "Under Review", value: "UNDER_REVIEW" },
                { label: "Active", value: "ACTIVE" },
                { label: "Expiring Soon", value: "EXPIRING_SOON" },
                { label: "Expired", value: "EXPIRED" },
                { label: "Terminated", value: "TERMINATED" },
                { label: "Renewed", value: "RENEWED" },
              ]}
            />
            <div className="grid grid-cols-2 gap-4">
              <Input name="value" label="Value" type="number" step="0.01" />
              <Input name="currency" label="Currency" defaultValue="USD" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input name="startDate" label="Start Date" type="date" />
              <Input name="endDate" label="End Date" type="date" />
            </div>
            <Input name="renewalDate" label="Renewal Date" type="date" />
            <div className="grid grid-cols-2 gap-4">
              <Input name="noticePeriodDays" label="Notice Period (days)" type="number" />
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="autoRenew" value="true" className="rounded" />
                  Auto-Renew
                </label>
              </div>
            </div>
            <Textarea name="summary" label="Summary" />
            <Textarea name="description" label="Description" />
            <Input name="externalDocumentUrl" label="Document URL" />
            <Select
              name="documentSourceType"
              label="Document Source"
              options={[
                { label: "Upload", value: "upload" },
                { label: "Google Drive", value: "google_drive" },
                { label: "External URL", value: "external_url" },
                { label: "Other", value: "other" },
              ]}
              placeholder="Select source"
            />
            {!defaultParentId && (
              <Select
                name="parentContractId"
                label="Parent Contract (optional)"
                options={parentContracts.map((c) => ({ label: c.title, value: c.id }))}
                placeholder="None"
              />
            )}
          </>
        )}
      </FormDialog>
    </>
  );
}
