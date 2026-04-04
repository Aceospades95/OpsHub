"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFormState } from "react-dom";
import { updateCertification, deleteCertification } from "@/actions/certifications";
import { Button } from "@/components/ui/button";
import { Edit, Trash2 } from "lucide-react";

const TYPES = ["INDUSTRY", "COMPLIANCE", "SAFETY", "PROFESSIONAL", "QUALITY", "SECURITY", "ENVIRONMENTAL", "VENDOR", "OTHER"];
const STATUSES = ["PENDING", "ACTIVE", "EXPIRING_SOON", "EXPIRED", "SUSPENDED", "REVOKED"];

interface CertActionsProps {
  cert: {
    id: string; name: string; description: string | null; certNumber: string | null;
    status: string; type: string; issuingBody: string | null;
    issuedDate: Date | null; expirationDate: Date | null; renewalDate: Date | null;
    renewalLeadDays: number | null; autoRenew: boolean; renewalCost: number | null;
    currency: string | null; renewalRequirements: string | null; renewalNotes: string | null;
    documentUrl: string | null; clientId: string | null; assigneeId: string | null;
  };
  clients: { id: string; name: string }[];
  users: { id: string; name: string }[];
}

function formatDate(d: Date | null) {
  if (!d) return "";
  return new Date(d).toISOString().split("T")[0];
}

export function CertActions({ cert, clients, users }: CertActionsProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editState, editAction] = useFormState(updateCertification, null);
  const [, deleteAction] = useFormState(deleteCertification, null);
  const router = useRouter();

  if (editState?.success) {
    router.refresh();
    setEditOpen(false);
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
        <Edit className="h-4 w-4 mr-1" /> Edit
      </Button>
      <Button size="sm" variant="outline" onClick={() => setDeleteOpen(true)} className="text-destructive hover:text-destructive">
        <Trash2 className="h-4 w-4" />
      </Button>

      {/* Edit Modal */}
      {editOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setEditOpen(false)}>
          <div className="bg-card rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-4">Edit Certification</h2>
            <form action={editAction} className="space-y-4">
              <input type="hidden" name="id" value={cert.id} />

              <div>
                <label className="text-sm font-medium">Name *</label>
                <input name="name" defaultValue={cert.name} required className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium">Type</label>
                  <select name="type" defaultValue={cert.type} className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background">
                    {TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium">Status</label>
                  <select name="status" defaultValue={cert.status} className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background">
                    {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium">Issuing Body</label>
                  <input name="issuingBody" defaultValue={cert.issuingBody || ""} className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background" />
                </div>
                <div>
                  <label className="text-sm font-medium">Cert Number</label>
                  <input name="certNumber" defaultValue={cert.certNumber || ""} className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background" />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-sm font-medium">Issued Date</label>
                  <input type="date" name="issuedDate" defaultValue={formatDate(cert.issuedDate)} className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background" />
                </div>
                <div>
                  <label className="text-sm font-medium">Expiration Date</label>
                  <input type="date" name="expirationDate" defaultValue={formatDate(cert.expirationDate)} className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background" />
                </div>
                <div>
                  <label className="text-sm font-medium">Renewal Date</label>
                  <input type="date" name="renewalDate" defaultValue={formatDate(cert.renewalDate)} className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background" />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-sm font-medium">Lead Days</label>
                  <input type="number" name="renewalLeadDays" defaultValue={cert.renewalLeadDays || 90} className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background" />
                </div>
                <div>
                  <label className="text-sm font-medium">Renewal Cost</label>
                  <input type="number" step="0.01" name="renewalCost" defaultValue={cert.renewalCost || ""} className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background" />
                </div>
                <div className="flex items-end pb-1">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="autoRenew" value="true" defaultChecked={cert.autoRenew} className="accent-primary" />
                    Auto-renew
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium">Client</label>
                  <select name="clientId" defaultValue={cert.clientId || ""} className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background">
                    <option value="">None</option>
                    {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium">Responsible Person</label>
                  <select name="assigneeId" defaultValue={cert.assigneeId || ""} className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background">
                    <option value="">None</option>
                    {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium">Renewal Requirements</label>
                <textarea name="renewalRequirements" rows={3} defaultValue={cert.renewalRequirements || ""} className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background" placeholder="What's needed for renewal..." />
              </div>

              <div>
                <label className="text-sm font-medium">Renewal Notes</label>
                <textarea name="renewalNotes" rows={2} defaultValue={cert.renewalNotes || ""} className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background" />
              </div>

              <div>
                <label className="text-sm font-medium">Description</label>
                <textarea name="description" rows={2} defaultValue={cert.description || ""} className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background" />
              </div>

              <div>
                <label className="text-sm font-medium">Document URL</label>
                <input name="documentUrl" defaultValue={cert.documentUrl || ""} className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background" />
              </div>

              {editState?.error && <p className="text-sm text-destructive">{editState.error}</p>}

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
                <Button type="submit">Save Changes</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      {deleteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setDeleteOpen(false)}>
          <div className="bg-card rounded-lg shadow-xl p-6 max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-2">Delete Certification?</h2>
            <p className="text-sm text-muted-foreground mb-4">This will permanently delete &quot;{cert.name}&quot;.</p>
            <form action={async (fd) => { await deleteAction(fd); router.push("/certifications"); }}>
              <input type="hidden" name="id" value={cert.id} />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
                <Button type="submit" variant="destructive">Delete</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
