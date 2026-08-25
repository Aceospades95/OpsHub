"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { linkBidContract } from "@/actions/bids";
import { FileSignature } from "lucide-react";

/**
 * Inline nudge on WON bids that never got their contract linked —
 * closes the bid → contract loop without opening the full edit
 * dialog. The options arrive pre-sorted by the server: contracts on
 * the bid's converted project first, then the rest of the client's
 * contracts.
 */
export function LinkContractNudge({
  bidId,
  contracts,
}: {
  bidId: string;
  /** Pre-filtered + pre-sorted by the server component. */
  contracts: { id: string; name: string }[];
}) {
  const [contractId, setContractId] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function save() {
    if (!contractId) {
      toast.error("Pick the contract this bid became");
      return;
    }
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", bidId);
      fd.set("contractId", contractId);
      const result = await linkBidContract(null, fd);
      if (result && "error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Contract linked");
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 space-y-2">
      <p className="flex items-center gap-2 text-sm font-medium">
        <FileSignature className="h-4 w-4 text-warning" />
        Won — link the contract it became
      </p>
      {contracts.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No contracts found for this client yet. Add the contract under Contracts, then link it
          here (or via Edit).
        </p>
      ) : (
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <Select
              name="contractId"
              aria-label="Contract"
              value={contractId}
              disabled={pending}
              onChange={(e) => setContractId(e.target.value)}
              options={[
                { label: "Pick a contract…", value: "" },
                ...contracts.map((c) => ({ label: c.name, value: c.id })),
              ]}
            />
          </div>
          <Button size="sm" onClick={save} disabled={pending || !contractId}>
            {pending ? "Linking…" : "Link"}
          </Button>
        </div>
      )}
    </div>
  );
}
