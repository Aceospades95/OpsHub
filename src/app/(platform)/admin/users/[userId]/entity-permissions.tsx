"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import { saveEntityPermission, deleteEntityPermission } from "@/actions/admin";
import { Plus, Trash2 } from "lucide-react";

interface EntityPerm {
  id: string;
  entityType: string;
  entityId: string;
  canView: boolean;
  canEdit: boolean;
  canComment: boolean;
  canUpload: boolean;
  canManage: boolean;
}

interface Props {
  userId: string;
  permissions: EntityPerm[];
  clients: { id: string; name: string }[];
  projects: { id: string; name: string }[];
}

export function EntityPermissionsEditor({ userId, permissions, clients, projects }: Props) {
  const [addOpen, setAddOpen] = useState(false);
  const [entityType, setEntityType] = useState("client");
  const router = useRouter();

  const entities = entityType === "client" ? clients : projects;
  const nameMap = new Map([
    ...clients.map((c) => [c.id, c.name] as const),
    ...projects.map((p) => [p.id, p.name] as const),
  ]);

  async function handleAdd(formData: FormData) {
    formData.set("userId", userId);
    await saveEntityPermission(null, formData);
    setAddOpen(false);
    router.refresh();
  }

  async function handleDelete(id: string) {
    const fd = new FormData();
    fd.set("id", id);
    await deleteEntityPermission(null, fd);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {permissions.length === 0 && (
        <p className="text-sm text-muted-foreground">No entity-level overrides</p>
      )}

      {permissions.map((perm) => (
        <div key={perm.id} className="flex items-center justify-between rounded border border-border p-3">
          <div>
            <p className="text-sm font-medium">
              {perm.entityType}: {nameMap.get(perm.entityId) || perm.entityId}
            </p>
            <div className="flex gap-2 mt-1 text-xs text-muted-foreground">
              {perm.canView && <span>View</span>}
              {perm.canEdit && <span>Edit</span>}
              {perm.canComment && <span>Comment</span>}
              {perm.canUpload && <span>Upload</span>}
              {perm.canManage && <span>Manage</span>}
            </div>
          </div>
          <button onClick={() => handleDelete(perm.id)} className="text-muted-foreground hover:text-destructive">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}

      <Button variant="outline" size="sm" className="w-full" onClick={() => setAddOpen(true)}>
        <Plus className="h-4 w-4 mr-1" /> Add Entity Override
      </Button>

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} title="Add Entity Permission">
        <form action={handleAdd} className="space-y-4">
          <Select
            name="entityType"
            label="Entity Type"
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
            options={[
              { label: "Client", value: "client" },
              { label: "Project", value: "project" },
            ]}
          />
          <Select
            name="entityId"
            label={entityType === "client" ? "Client" : "Project"}
            options={entities.map((e) => ({ label: e.name, value: e.id }))}
            placeholder="Select entity"
            required
          />
          <div className="space-y-2">
            <p className="text-sm font-medium">Permissions</p>
            {["canView", "canEdit", "canComment", "canUpload", "canManage"].map((flag) => (
              <label key={flag} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name={flag} value="true" className="rounded" />
                {flag.replace("can", "")}
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
