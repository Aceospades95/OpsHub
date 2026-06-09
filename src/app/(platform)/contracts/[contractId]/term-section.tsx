"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { FormDialog } from "@/components/shared/form-dialog";
import { useConfirm } from "@/components/shared/use-confirm";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { createContractTerm, deleteContractTerm } from "@/actions/contracts";
import { Plus, Trash2 } from "lucide-react";
import { formatCalendarDate } from "@/lib/dates";

interface Term {
  id: string;
  type: string;
  title: string;
  description: string;
  priority: string | null;
  dueDate: Date | null;
}

interface Props {
  terms: Term[];
  contractId: string;
  canEdit: boolean;
  canDelete: boolean;
}

export function TermSection({ terms, contractId, canEdit, canDelete }: Props) {
  const [createOpen, setCreateOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const { confirm, ConfirmDialog } = useConfirm();
  const router = useRouter();

  async function handleDelete(id: string, title: string) {
    const ok = await confirm({
      title: `Delete term "${title}"?`,
      message: "This can't be undone.",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", id);
      const result = await deleteContractTerm(null, fd);
      if (result && "error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Term deleted");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {terms.length === 0 && <p className="text-sm text-muted-foreground">No terms defined</p>}

      {terms.map((term) => (
        <div key={term.id} className="rounded border border-border bg-muted p-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="outline">{term.type}</Badge>
              {term.priority && <StatusBadge status={term.priority} />}
            </div>
            {canDelete && (
              <button
                onClick={() => handleDelete(term.id, term.title)}
                disabled={isPending}
                aria-label={`Delete term "${term.title}"`}
                className="text-muted-foreground hover:text-destructive disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
          <p className="text-sm font-medium">{term.title}</p>
          <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{term.description}</p>
          {term.dueDate && (
            <p className="text-xs text-muted-foreground mt-2">
              Due: {formatCalendarDate(term.dueDate, "MMM d, yyyy")}
            </p>
          )}
        </div>
      ))}

      {canEdit && (
        <>
          <Button variant="outline" size="sm" className="w-full" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Add Term
          </Button>
          <FormDialog open={createOpen} onClose={() => setCreateOpen(false)} title="Add Contract Term" action={createContractTerm}>
            {({ fieldErrors }) => (
              <>
                <input type="hidden" name="contractId" value={contractId} />
                <Select
                  name="type"
                  label="Type"
                  options={["SLA","OBLIGATION","DEADLINE","DELIVERABLE","ESCALATION","RENEWAL","BILLING","PENALTY","OTHER"].map(t => ({ label: t, value: t }))}
                />
                <Input name="title" label="Title" required error={fieldErrors?.title?.[0]} />
                <Textarea name="description" label="Description" required error={fieldErrors?.description?.[0]} />
                <Select
                  name="priority"
                  label="Priority"
                  options={[{label:"High",value:"HIGH"},{label:"Medium",value:"MEDIUM"},{label:"Low",value:"LOW"}]}
                />
                <Input name="dueDate" label="Due Date" type="date" />
              </>
            )}
          </FormDialog>
        </>
      )}
      <ConfirmDialog />
    </div>
  );
}
