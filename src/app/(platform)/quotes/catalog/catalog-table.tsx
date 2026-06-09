"use client";

import { useState, useTransition } from "react";
import { useFormState } from "react-dom";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Archive } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useConfirm } from "@/components/shared/use-confirm";
import {
  createCatalogItem,
  updateCatalogItem,
  deleteCatalogItem,
} from "@/actions/catalog";
import { pluralize } from "@/lib/pluralize";

interface CatalogRow {
  id: string;
  name: string;
  description: string | null;
  defaultUnitPrice: number;
  defaultUnit: string | null;
  category: string | null;
  isRecurring: boolean;
  isActive: boolean;
  priceLabel: string;
}

interface Props {
  items: CatalogRow[];
  canEdit: boolean;
  canCreate: boolean;
  canDelete: boolean;
}

export function CatalogTable({ items, canEdit, canCreate, canDelete }: Props) {
  const [editing, setEditing] = useState<CatalogRow | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div>
      <div className="flex items-center justify-between p-4 border-b border-border">
        <p className="text-xs text-muted-foreground">
          {pluralize(items.length, "item")} ·{" "}
          {items.filter((i) => i.isActive).length} active
        </p>
        {canCreate && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New item
          </Button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Name</th>
              <th className="px-4 py-3 text-left font-medium">Category</th>
              <th className="px-4 py-3 text-right font-medium">Price</th>
              <th className="px-4 py-3 text-left font-medium">Unit</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium" />
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr
                key={it.id}
                className="border-t border-border hover:bg-muted/40 transition-colors"
              >
                <td className="px-4 py-3">
                  <p className="font-medium">{it.name}</p>
                  {it.description && (
                    <p className="text-xs text-muted-foreground line-clamp-1">
                      {it.description}
                    </p>
                  )}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {it.category ?? "—"}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {it.priceLabel}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {it.defaultUnit ?? "—"}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {it.isActive ? (
                      <Badge variant="success" className="text-xs">
                        Active
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs">
                        Archived
                      </Badge>
                    )}
                    {it.isRecurring && (
                      <Badge variant="secondary" className="text-xs">
                        Recurring
                      </Badge>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-right">
                  {canEdit && (
                    <button
                      onClick={() => setEditing(it)}
                      className="text-muted-foreground hover:text-foreground p-1"
                      aria-label="Edit"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  )}
                  {canDelete && it.isActive && (
                    <ArchiveButton id={it.id} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {creating && (
        <CatalogFormDialog
          mode="create"
          item={null}
          onClose={() => setCreating(false)}
        />
      )}
      {editing && (
        <CatalogFormDialog
          mode="edit"
          item={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function ArchiveButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { confirm, ConfirmDialog } = useConfirm();

  async function handle() {
    const ok = await confirm({
      title: "Archive this catalog item?",
      message: "Existing quote line items keep working.",
      confirmLabel: "Archive",
    });
    if (!ok) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", id);
      const res = await deleteCatalogItem(undefined, fd);
      if (res && "error" in res && res.error) alert(res.error);
      else router.refresh();
    });
  }

  return (
    <>
      <button
        onClick={handle}
        disabled={pending}
        className="text-muted-foreground hover:text-destructive p-1 ml-1"
        aria-label="Archive"
      >
        <Archive className="h-3 w-3" />
      </button>
      <ConfirmDialog />
    </>
  );
}

interface CatalogFormProps {
  mode: "create" | "edit";
  item: CatalogRow | null;
  onClose: () => void;
}

function CatalogFormDialog({ mode, item, onClose }: CatalogFormProps) {
  const router = useRouter();
  const action = mode === "create" ? createCatalogItem : updateCatalogItem;
  // useFormState from react-dom (not useActionState from "react") — the
  // latter is a React 19 hook and is undefined at runtime on React 18.3,
  // which crashes this dialog the moment an admin opens it.
  const [state, formAction] = useFormState(action, null);
  const [pending, setPending] = useState(false);

  const submitted =
    state && typeof state === "object" && "success" in state && state.success;
  if (submitted) {
    queueMicrotask(() => {
      onClose();
      router.refresh();
    });
  }

  const errMessage =
    state && typeof state === "object" && "error" in state ? state.error : null;

  return (
    <Dialog
      open
      onClose={onClose}
      title={mode === "create" ? "New catalog item" : `Edit ${item?.name ?? ""}`}
    >
      <form
        action={(fd) => {
          setPending(true);
          formAction(fd);
        }}
        className="space-y-4"
      >
        {item && <input type="hidden" name="id" value={item.id} />}
        <Input
          label="Name"
          name="name"
          defaultValue={item?.name ?? ""}
          required
        />
        <Textarea
          label="Description"
          name="description"
          defaultValue={item?.description ?? ""}
          rows={3}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Default unit price"
            name="defaultUnitPrice"
            type="number"
            min="0"
            step="0.01"
            defaultValue={item?.defaultUnitPrice ?? 0}
          />
          <Input
            label="Default unit"
            name="defaultUnit"
            defaultValue={item?.defaultUnit ?? ""}
            placeholder="ea, hour, device"
          />
        </div>
        <Input
          label="Category"
          name="category"
          defaultValue={item?.category ?? ""}
          placeholder="Hardware, Services, Subscription…"
        />
        <div className="flex items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="isRecurring"
              value="true"
              defaultChecked={item?.isRecurring ?? false}
            />
            Recurring revenue
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="isActive"
              value="true"
              defaultChecked={item?.isActive ?? true}
            />
            Active (show in quote autocomplete)
          </label>
        </div>
        {errMessage && <p className="text-sm text-destructive">{errMessage}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" type="button" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
