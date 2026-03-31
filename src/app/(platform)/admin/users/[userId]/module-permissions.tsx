"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { saveModulePermissions } from "@/actions/admin";
import { useState } from "react";

const MODULES = ["clients", "projects", "contracts", "suppliers", "tools", "intranet", "admin"];
const FLAGS = ["canView", "canEdit", "canCreate", "canDelete", "canComment", "canUpload", "canManage"];

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
              {FLAGS.map((flag) => (
                <th key={flag} className="p-2 font-medium text-center text-xs">
                  {flag.replace("can", "")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MODULES.map((mod) => {
              const perm = permMap.get(mod);
              return (
                <tr key={mod} className="border-b border-border">
                  <td className="p-2 font-medium capitalize">{mod}</td>
                  {FLAGS.map((flag) => (
                    <td key={flag} className="p-2 text-center">
                      <input
                        type="checkbox"
                        name={`${mod}_${flag}`}
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
