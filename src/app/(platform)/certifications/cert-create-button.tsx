"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFormState } from "react-dom";
import { createCertification } from "@/actions/certifications";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

const TYPES = ["INDUSTRY", "COMPLIANCE", "SAFETY", "PROFESSIONAL", "QUALITY", "SECURITY", "ENVIRONMENTAL", "VENDOR", "OTHER"];
const STATUSES = ["PENDING", "ACTIVE", "EXPIRING_SOON", "EXPIRED", "SUSPENDED", "REVOKED"];

export function CertCreateButton({
  clients,
  users,
}: {
  clients: { id: string; name: string }[];
  users: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useFormState(createCertification, null);
  const router = useRouter();

  if (state?.success && state.id) {
    router.push(`/certifications/${state.id}`);
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4 mr-1" /> Add Certification
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setOpen(false)}>
          <div className="bg-card rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-4">New Certification</h2>
            <form action={action} className="space-y-4">
              <div>
                <label className="text-sm font-medium">Name *</label>
                <input name="name" required className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium">Type</label>
                  <select name="type" defaultValue="OTHER" className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background">
                    {TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium">Status</label>
                  <select name="status" defaultValue="PENDING" className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background">
                    {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium">Issuing Body</label>
                  <input name="issuingBody" className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background" placeholder="e.g. ISO, OSHA" />
                </div>
                <div>
                  <label className="text-sm font-medium">Cert Number</label>
                  <input name="certNumber" className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium">Issued Date</label>
                  <input type="date" name="issuedDate" className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background" />
                </div>
                <div>
                  <label className="text-sm font-medium">Expiration Date</label>
                  <input type="date" name="expirationDate" className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium">Client</label>
                  <select name="clientId" className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background">
                    <option value="">None</option>
                    {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium">Responsible Person</label>
                  <select name="assigneeId" className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background">
                    <option value="">None</option>
                    {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium">Description</label>
                <textarea name="description" rows={2} className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background" />
              </div>

              {state?.error && <p className="text-sm text-destructive">{state.error}</p>}

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit">Create</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
