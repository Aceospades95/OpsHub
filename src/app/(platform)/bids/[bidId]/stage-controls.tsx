"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormDialog } from "@/components/shared/form-dialog";
import { updateBidStatusInline, convertBidToProject } from "@/actions/bids";
import { BID_STATUS_OPTIONS, type BidOption } from "../bid-create-button";
import { FolderPlus } from "lucide-react";

/**
 * Quick pipeline controls on the bid detail page: a stage select that
 * saves immediately, and — for won work — the convert-to-project
 * hand-off that closes the loop from pipeline to delivery.
 */
export function StageControls({
  bid,
  clients,
  canEdit,
  canCreateProject,
}: {
  bid: {
    id: string;
    title: string;
    status: string;
    clientId: string | null;
    projectId: string | null;
  };
  clients: BidOption[];
  canEdit: boolean;
  canCreateProject: boolean;
}) {
  const [convertOpen, setConvertOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [, startTransition] = useTransition();
  const router = useRouter();

  async function moveStage(status: string) {
    if (status === bid.status) return;
    setSaving(true);
    try {
      const fd = new FormData();
      fd.set("id", bid.id);
      fd.set("status", status);
      const result = await updateBidStatusInline(null, fd);
      if (result && "error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`Moved to ${BID_STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status}`);
      startTransition(() => router.refresh());
    } catch {
      toast.error("Couldn't update the stage — try again");
    } finally {
      setSaving(false);
    }
  }

  if (!canEdit) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="w-44">
        <Select
          name="stage"
          aria-label="Stage"
          value={bid.status}
          disabled={saving}
          onChange={(e) => moveStage(e.target.value)}
          options={BID_STATUS_OPTIONS}
        />
      </div>

      {canCreateProject && !bid.projectId && (
        <>
          <Button variant="outline" size="sm" onClick={() => setConvertOpen(true)}>
            <FolderPlus className="h-4 w-4 mr-1" /> Convert to project
          </Button>
          <FormDialog
            open={convertOpen}
            onClose={() => setConvertOpen(false)}
            title="Convert won bid to project"
            action={convertBidToProject}
            submitLabel="Create project"
          >
            {({ fieldErrors }) => (
              <>
                <input type="hidden" name="id" value={bid.id} />
                <Input
                  name="name"
                  label="Project name"
                  required
                  defaultValue={bid.title}
                  error={fieldErrors?.name?.[0]}
                />
                <Select
                  name="clientId"
                  label="Client"
                  defaultValue={bid.clientId ?? ""}
                  options={[
                    { label: "Pick a client…", value: "" },
                    ...clients.map((c) => ({ label: c.name, value: c.id })),
                  ]}
                />
                <p className="text-xs text-muted-foreground -mt-1">
                  Marks the bid Won and creates a Planning project linked back to it. If the
                  agency isn&apos;t a client yet, add them under Clients first.
                </p>
              </>
            )}
          </FormDialog>
        </>
      )}
    </div>
  );
}
