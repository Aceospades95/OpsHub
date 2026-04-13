"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { saveModulePermissions } from "@/actions/admin";
import { useState } from "react";
import {
  getPermissionedModules,
  ALL_PERMISSION_FLAGS,
  PERMISSION_FLAG_LABELS,
} from "@/lib/modules";

interface Permission {
  module: string;
  canView: boolean;
  canEdit: boolean;
  canCreate: boolean;
  canDelete: boolean;
  canComment: boolean;
  canUpload: boolean;
  canManage: boolean;
}

interface Props {
  userId: string;
  permissions: Permission[];
}

export function ModulePermissionsEditor({ userId, permissions }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  // Drive the module list and flag columns from the registry so new modules
  // show up automatically when added to src/lib/modules.ts.
  const modules = getPermissionedModules();
  const permMap = new Map(permissions.map((p) => [p.module, p]));

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    const formData = new FormData(e.currentTarget);
    formData.set("userId", userId);
    await saveModulePermissions(null, formData);
    setSaving(false);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left p-2 font-medium">Module</th>
              {ALL_PERMISSION_FLAGS.map((flag) => (
                <th key={flag} className="p-2 font-medium text-center text-xs">
                  {PERMISSION_FLAG_LABELS[flag]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {modules.map((mod) => {
              const perm = permMap.get(mod.key);
              return (
                <tr key={mod.key} className="border-b border-border">
                  <td className="p-2 font-medium">
                    <div>{mod.label}</div>
                    <div className="text-[11px] text-muted-foreground font-normal">{mod.description}</div>
                  </td>
                  {ALL_PERMISSION_FLAGS.map((flag) => (
                    <td key={flag} className="p-2 text-center">
                      <input
                        type="checkbox"
                        name={`${mod.key}_${flag}`}
                        value="true"
                        defaultChecked={perm ? (perm as unknown as Record<string, boolean>)[flag] : false}
                        className="rounded"
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex justify-end">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? "Saving..." : "Save Permissions"}
        </Button>
      </div>
    </form>
  );
}
