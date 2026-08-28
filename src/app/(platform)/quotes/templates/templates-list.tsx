"use client";

import Link from "next/link";
import { toast } from "sonner";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Trash2, FilePlus2, Download } from "lucide-react";
import { useConfirm } from "@/components/shared/use-confirm";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { createQuote } from "@/actions/quotes";
import { deleteQuoteTemplate } from "@/actions/quote-templates";

interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  lineItemCount: number;
  createdByName: string;
  createdById: string;
  updatedAt: string;
}

interface Props {
  templates: TemplateRow[];
  clients: { id: string; name: string }[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export function TemplatesList({ templates, clients, canCreate, canDelete }: Props) {
  const [useTplOpen, setUseTplOpen] = useState<TemplateRow | null>(null);

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Name</th>
              <th className="px-4 py-3 text-left font-medium">Items</th>
              <th className="px-4 py-3 text-left font-medium">Created by</th>
              <th className="px-4 py-3 text-left font-medium">Updated</th>
              <th className="px-4 py-3 text-right font-medium" />
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => (
              <tr
                key={t.id}
                className="border-t border-border hover:bg-muted/40 transition-colors"
              >
                <td className="px-4 py-3">
                  <p className="font-medium">{t.name}</p>
                  {t.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {t.description}
                    </p>
                  )}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {t.lineItemCount}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  <Link
                    href={`/team/${t.createdById}`}
                    className="hover:text-primary hover:underline"
                  >
                    {t.createdByName}
                  </Link>
                </td>
                <td className="px-4 py-3 text-muted-foreground text-xs">
                  {format(new Date(t.updatedAt), "MMM d, yyyy")}
                </td>
                <td className="px-4 py-3 text-right">
                  <a
                    href={`/api/quote-templates/${t.id}/docx`}
                    className="text-muted-foreground hover:text-foreground text-xs mr-3 inline-flex items-center"
                    aria-label="Download as Word"
                  >
                    <Download className="h-3 w-3 inline mr-1" />
                    .docx
                  </a>
                  {canCreate && (
                    <button
                      onClick={() => setUseTplOpen(t)}
                      className="text-primary hover:underline text-xs mr-3"
                    >
                      <FilePlus2 className="h-3 w-3 inline mr-1" />
                      Use
                    </button>
                  )}
                  {canDelete && <DeleteButton id={t.id} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {useTplOpen && (
        <UseTemplateDialog
          template={useTplOpen}
          clients={clients}
          onClose={() => setUseTplOpen(null)}
        />
      )}
    </div>
  );
}

function DeleteButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { confirm, ConfirmDialog } = useConfirm();

  async function handle() {
    const ok = await confirm({
      title: "Delete this template?",
      message:
        "Existing quotes that were created from it are unaffected.",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", id);
      const res = await deleteQuoteTemplate(undefined, fd);
      if (res && "error" in res && res.error) toast.error(res.error);
      else router.refresh();
    });
  }

  return (
    <>
      <button
        onClick={handle}
        disabled={pending}
        className="text-muted-foreground hover:text-destructive p-1"
        aria-label="Delete template"
      >
        <Trash2 className="h-3 w-3" />
      </button>
      <ConfirmDialog />
    </>
  );
}

function UseTemplateDialog({
  template,
  clients,
  onClose,
}: {
  template: TemplateRow;
  clients: { id: string; name: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [clientId, setClientId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handle() {
    setError(null);
    if (!clientId) {
      setError("Choose a client");
      return;
    }
    startTransition(async () => {
      const res = await createQuote({
        fromTemplateId: template.id,
        clientId,
      });
      if ("error" in res) {
        setError(res.error ?? "Unknown error");
        return;
      }
      router.push(`/quotes/${res.id}/edit`);
    });
  }

  return (
    <Dialog open onClose={onClose} title={`Use "${template.name}"`}>
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
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={handle} disabled={pending}>
            {pending ? "Creating…" : "Create draft"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
