"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteCustomWidget, toggleCustomWidgetPublished } from "@/actions/custom-widgets";
import { Eye, EyeOff, Trash2, MoreVertical } from "lucide-react";
import { useConfirm } from "@/components/shared/use-confirm";

export function WidgetListActions({ widgetId, isPublished }: { widgetId: string; isPublished: boolean }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { confirm, ConfirmDialog } = useConfirm();

  async function handleToggle() {
    setLoading(true);
    await toggleCustomWidgetPublished(widgetId);
    setLoading(false);
    setOpen(false);
    router.refresh();
  }

  async function handleDelete() {
    const ok = await confirm({
      title: "Delete this widget?",
      message: "This cannot be undone.",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    setLoading(true);
    await deleteCustomWidget(widgetId);
    setLoading(false);
    setOpen(false);
    router.refresh();
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="p-1 rounded hover:bg-muted text-muted-foreground"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 w-44 bg-card border border-border rounded-lg shadow-lg z-50 py-1">
            <button
              onClick={handleToggle}
              disabled={loading}
              className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2"
            >
              {isPublished ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              {isPublished ? "Unpublish" : "Publish"}
            </button>
            <button
              onClick={handleDelete}
              disabled={loading}
              className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2 text-destructive"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          </div>
        </>
      )}
      <ConfirmDialog />
    </div>
  );
}
