"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormDialog } from "@/components/shared/form-dialog";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  linkPartnershipProject,
  updatePartnershipProject,
  unlinkPartnershipProject,
} from "@/actions/partnerships";
import { Plus, Pencil, X } from "lucide-react";

interface PartnershipProjectLink {
  id: string;
  projectId: string;
  projectName: string;
  projectStatus: string | null;
  clientName: string | null;
  clientId: string | null;
  role: string;
  notes: string | null;
  referralValue: number | null;
  currency: string | null;
}

interface Props {
  partnershipId: string;
  links: PartnershipProjectLink[];
  allProjects: { id: string; name: string }[];
  canEdit: boolean;
}

const ROLE_OPTIONS = [
  { label: "Referrer", value: "REFERRER" },
  { label: "Co-delivery", value: "CO_DELIVERY" },
  { label: "Joint ownership", value: "JOINT_OWNERSHIP" },
  { label: "Reseller", value: "RESELLER" },
  { label: "Integration", value: "INTEGRATION" },
  { label: "Subcontracted", value: "SUBCONTRACTED" },
  { label: "Other", value: "OTHER" },
];

const fmtCurrency = (n: number, currency = "USD") =>
  n.toLocaleString("en-US", { style: "currency", currency, minimumFractionDigits: 0 });

const ROLE_LABEL: Record<string, string> = {
  REFERRER: "Referrer",
  CO_DELIVERY: "Co-delivery",
  JOINT_OWNERSHIP: "Joint ownership",
  RESELLER: "Reseller",
  INTEGRATION: "Integration",
  SUBCONTRACTED: "Subcontracted",
  OTHER: "Other",
};

export function PartnershipProjects({ partnershipId, links, allProjects, canEdit }: Props) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [editLink, setEditLink] = useState<PartnershipProjectLink | null>(null);
  const router = useRouter();

  const linkedIds = new Set(links.map((l) => l.projectId));
  const available = allProjects.filter((p) => !linkedIds.has(p.id));

  async function handleUnlink(id: string) {
    const fd = new FormData();
    fd.set("id", id);
    await unlinkPartnershipProject(null, fd);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {links.length === 0 && <p className="text-sm text-muted-foreground">Not engaged on any projects</p>}

      {links.map((l) => (
        <div key={l.id} className="rounded border border-border bg-muted p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <Link href={`/projects/${l.projectId}`} className="text-sm font-medium hover:text-primary hover:underline">
                  {l.projectName}
                </Link>
                {l.projectStatus && <StatusBadge status={l.projectStatus} />}
                <Badge variant="outline">{ROLE_LABEL[l.role] || l.role}</Badge>
              </div>
              {l.clientName && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  <Link href={`/clients/${l.clientId}`} className="hover:underline hover:text-primary">
                    {l.clientName}
                  </Link>
                </p>
              )}
              {l.referralValue != null && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Referral value: {fmtCurrency(l.referralValue, l.currency || "USD")}
                </p>
              )}
              {l.notes && <p className="mt-2 text-xs whitespace-pre-wrap text-muted-foreground">{l.notes}</p>}
            </div>
            {canEdit && (
              <div className="flex gap-1 shrink-0">
                <button onClick={() => setEditLink(l)} className="rounded p-1 text-muted-foreground hover:text-foreground">
                  <Pencil className="h-3 w-3" />
                </button>
                <button onClick={() => handleUnlink(l.id)} className="rounded p-1 text-muted-foreground hover:text-destructive">
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
        </div>
      ))}

      {canEdit && available.length > 0 && (
        <>
          <Button variant="outline" size="sm" className="w-full" onClick={() => setLinkOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Link Project
          </Button>
          <FormDialog
            open={linkOpen}
            onClose={() => setLinkOpen(false)}
            title="Link to Project"
            action={linkPartnershipProject}
            submitLabel="Link"
          >
            {() => (
              <>
                <input type="hidden" name="partnershipId" value={partnershipId} />
                <Select
                  name="projectId"
                  label="Project"
                  options={available.map((p) => ({ label: p.name, value: p.id }))}
                  placeholder="Select project"
                  required
                />
                <Select name="role" label="Partner's role" options={ROLE_OPTIONS} defaultValue="OTHER" />
                <Input name="referralValue" label="Referral / attributed value" type="number" step="0.01" />
                <Textarea name="notes" label="Notes" />
              </>
            )}
          </FormDialog>
        </>
      )}

      {editLink && (
        <FormDialog
          open={!!editLink}
          onClose={() => setEditLink(null)}
          title={`Edit: ${editLink.projectName}`}
          action={updatePartnershipProject}
        >
          {() => (
            <>
              <input type="hidden" name="id" value={editLink.id} />
              <Select name="role" label="Partner's role" options={ROLE_OPTIONS} defaultValue={editLink.role} />
              <Input
                name="referralValue"
                label="Referral / attributed value"
                type="number"
                step="0.01"
                defaultValue={editLink.referralValue?.toString() || ""}
              />
              <Textarea name="notes" label="Notes" defaultValue={editLink.notes || ""} />
            </>
          )}
        </FormDialog>
      )}
    </div>
  );
}
