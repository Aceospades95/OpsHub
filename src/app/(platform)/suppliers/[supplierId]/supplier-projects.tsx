"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { linkSupplierProject, unlinkSupplierProject } from "@/actions/suppliers";
import { Plus, X } from "lucide-react";

interface SupplierProjectData {
  id: string;
  projectId: string;
  notes: string | null;
}

interface Props {
  supplierProjects: SupplierProjectData[];
  supplierId: string;
  allProjects: { id: string; name: string }[];
  canEdit: boolean;
}

export function SupplierProjects({ supplierProjects, supplierId, allProjects, canEdit }: Props) {
  const [linkOpen, setLinkOpen] = useState(false);
  const router = useRouter();

  const linkedIds = new Set(supplierProjects.map((sp) => sp.projectId));
  const available = allProjects.filter((p) => !linkedIds.has(p.id));

  async function handleLink(formData: FormData) {
    formData.set("supplierId", supplierId);
    await linkSupplierProject(null, formData);
    setLinkOpen(false);
    router.refresh();
  }

  async function handleUnlink(id: string) {
    const fd = new FormData();
    fd.set("id", id);
    await unlinkSupplierProject(null, fd);
    router.refresh();
  }

  const projectMap = Object.fromEntries(allProjects.map((p) => [p.id, p.name]));

  return (
    <div className="space-y-2">
      {supplierProjects.length === 0 && <p className="text-sm text-muted-foreground">No linked projects</p>}

      {supplierProjects.map((sp) => (
        <div key={sp.id} className="flex items-center justify-between rounded border border-border p-3">
          <div>
            <p className="text-sm font-medium">{projectMap[sp.projectId] || sp.projectId}</p>
            {sp.notes && <p className="text-xs text-muted-foreground">{sp.notes}</p>}
          </div>
          {canEdit && (
            <button onClick={() => handleUnlink(sp.id)} className="text-muted-foreground hover:text-destructive">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      ))}

      {canEdit && (
        <>
          <Button variant="outline" size="sm" className="w-full" onClick={() => setLinkOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Link Project
          </Button>
          <Dialog open={linkOpen} onClose={() => setLinkOpen(false)} title="Link Project">
            <form action={handleLink} className="space-y-4">
              <Select
                name="projectId"
                label="Project"
                options={available.map((p) => ({ label: p.name, value: p.id }))}
                placeholder="Select project"
                required
              />
              <Input name="notes" label="Notes (optional)" />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setLinkOpen(false)}>Cancel</Button>
                <Button type="submit">Link</Button>
              </div>
            </form>
          </Dialog>
        </>
      )}
    </div>
  );
}
