"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { createQuote } from "@/actions/quotes";

interface ClientOption {
  id: string;
  name: string;
}

export function QuoteCreateButton({ clients }: { clients: ClientOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleCreate() {
    setError(null);
    if (!clientId) {
      setError("Choose a client");
      return;
    }
    startTransition(async () => {
      const res = await createQuote({ clientId });
      if ("error" in res) {
        setError(res.error ?? "Unknown error");
        return;
      }
      setOpen(false);
      router.push(`/quotes/${res.id}/edit`);
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4 mr-2" />
        New Quote
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="New Quote">
        <div className="space-y-4">
          <Select
            label="Client"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="Select a client"
            options={clients.map((c) => ({ label: c.name, value: c.id }))}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={pending}>
              {pending ? "Creating…" : "Create Draft"}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

interface QuickCreateButtonProps {
  clientId?: string;
  projectId?: string;
  label?: string;
}

/**
 * Inline "New Quote" button used on client/project detail pages where the
 * client (and optionally project) are pre-selected. Skips the dialog.
 */
export function QuickQuoteCreateButton({
  clientId,
  projectId,
  label = "New Quote",
}: QuickCreateButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handle() {
    setError(null);
    startTransition(async () => {
      const res = await createQuote({ clientId, projectId });
      if ("error" in res) {
        setError(res.error ?? "Unknown error");
        return;
      }
      router.push(`/quotes/${res.id}/edit`);
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="outline" onClick={handle} disabled={pending}>
        <Plus className="h-3 w-3 mr-1" />
        {pending ? "Creating…" : label}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
