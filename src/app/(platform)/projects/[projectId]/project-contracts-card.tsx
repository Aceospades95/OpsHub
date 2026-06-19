"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/shared/status-badge";
import { useConfirm } from "@/components/shared/use-confirm";
import {
  linkContractToProject,
  unlinkContractFromProject,
} from "@/actions/contracts";
import { Plus, X, FileText } from "lucide-react";

interface LinkedContract {
  id: string;
  title: string;
  status: string;
}

/** Same-client contracts the project doesn't already have. When a
 *  contract is currently on another project we surface that so linking
 *  it here is understood as a move, not a silent steal. */
interface AvailableContract {
  id: string;
  title: string;
  currentProjectName: string | null;
}

interface Props {
  projectId: string;
  contracts: LinkedContract[];
  availableContracts: AvailableContract[];
  canEdit: boolean;
}

export function ProjectContractsCard({
  projectId,
  contracts,
  availableContracts,
  canEdit,
}: Props) {
  const [selectedId, setSelectedId] = useState("");
  const [isPending, startTransition] = useTransition();
  const { confirm, ConfirmDialog } = useConfirm();
  const router = useRouter();

  function handleLink() {
    if (!selectedId) return;
    const choice = availableContracts.find((c) => c.id === selectedId);
    startTransition(async () => {
      // Moving a contract off another project is destructive enough to
      // confirm; attaching an unlinked contract is not.
      if (choice?.currentProjectName) {
        const ok = await confirm({
          title: "Move this contract?",
          message: `"${choice.title}" is currently on ${choice.currentProjectName}. Linking it here will move it off that project.`,
          confirmLabel: "Move it here",
        });
        if (!ok) return;
      }
      const result = await linkContractToProject(selectedId, projectId);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Contract linked");
      setSelectedId("");
      router.refresh();
    });
  }

  function handleUnlink(id: string, title: string) {
    startTransition(async () => {
      const ok = await confirm({
        title: "Unlink this contract?",
        message: `"${title}" will be detached from this project. The contract itself stays under its client.`,
        confirmLabel: "Unlink",
      });
      if (!ok) return;
      const result = await unlinkContractFromProject(id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Contract unlinked");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {contracts.length === 0 ? (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <FileText className="h-4 w-4" /> No contracts linked to this project
        </p>
      ) : (
        <div className="space-y-2">
          {contracts.map((contract) => (
            <div
              key={contract.id}
              className="flex items-center justify-between gap-2 rounded border border-border bg-muted p-3"
            >
              <Link
                href={`/contracts/${contract.id}`}
                className="min-w-0 flex-1 hover:text-primary transition-colors"
              >
                <p className="text-sm font-medium truncate">{contract.title}</p>
              </Link>
              <StatusBadge status={contract.status} />
              {canEdit && (
                <button
                  type="button"
                  onClick={() => handleUnlink(contract.id, contract.title)}
                  disabled={isPending}
                  aria-label={`Unlink contract ${contract.title}`}
                  className="rounded p-1 text-muted-foreground hover:text-destructive disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {canEdit && availableContracts.length > 0 && (
        <div className="flex items-end gap-2 pt-1">
          <div className="flex-1">
            <Select
              label="Link an existing contract"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              placeholder="Choose a contract…"
              options={availableContracts.map((c) => ({
                value: c.id,
                label: c.currentProjectName
                  ? `${c.title} (on ${c.currentProjectName})`
                  : c.title,
              }))}
            />
          </div>
          <Button
            type="button"
            size="sm"
            onClick={handleLink}
            disabled={!selectedId || isPending}
          >
            <Plus className="h-4 w-4 mr-1" /> Link
          </Button>
        </div>
      )}

      {canEdit && availableContracts.length === 0 && contracts.length > 0 && (
        <p className="text-xs text-muted-foreground">
          All of this client&apos;s contracts are already linked here.
        </p>
      )}
      {canEdit && availableContracts.length === 0 && contracts.length === 0 && (
        <Link
          href={`/contracts`}
          className="text-xs text-primary hover:underline"
        >
          + Create a contract for this client first
        </Link>
      )}

      <ConfirmDialog />
    </div>
  );
}
