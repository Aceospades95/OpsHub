"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormState } from "react-dom";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ListChecks, Plus, X } from "lucide-react";
import {
  addChecklistItem,
  toggleChecklistItem,
  removeChecklistItem,
} from "@/actions/certifications";

interface ChecklistItem {
  id: string;
  label: string;
  required: boolean;
  completed: boolean;
  completedAt: Date | null;
  completedBy: { id: string; name: string } | null;
  sortOrder: number;
  notes: string | null;
}

interface Props {
  certId: string;
  items: ChecklistItem[];
  canModify: boolean;
}

export function ChecklistCard({ certId, items, canModify }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [addOpen, setAddOpen] = useState(false);
  const [addState, addAction] = useFormState(addChecklistItem, null);

  useEffect(() => {
    if (addState?.success) {
      setAddOpen(false);
      router.refresh();
    }
  }, [addState, router]);

  const handleToggle = (itemId: string) => {
    const fd = new FormData();
    fd.set("itemId", itemId);
    startTransition(async () => {
      await toggleChecklistItem(null, fd);
      router.refresh();
    });
  };

  const handleRemove = (itemId: string) => {
    const fd = new FormData();
    fd.set("itemId", itemId);
    startTransition(async () => {
      await removeChecklistItem(null, fd);
      router.refresh();
    });
  };

  const completedCount = items.filter((i) => i.completed).length;

  return (
    <Card className="h-full">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          <ListChecks className="h-4 w-4" />
          Renewal Checklist
          {items.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">
              ({completedCount}/{items.length})
            </span>
          )}
        </CardTitle>
        {canModify && !addOpen && (
          <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {addOpen && (
          <form action={addAction} className="space-y-2 mb-4 p-3 bg-muted rounded-md">
            <input type="hidden" name="certId" value={certId} />
            <input
              name="label"
              required
              placeholder="e.g. Submit current tax return"
              className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background"
            />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="required" value="true" className="accent-primary" />
              Required for this cert
            </label>
            {addState?.error && (
              <p className="text-xs text-destructive">{addState.error}</p>
            )}
            <div className="flex gap-2">
              <Button type="submit" size="sm">
                Add item
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setAddOpen(false)}>
                Cancel
              </Button>
            </div>
          </form>
        )}

        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No checklist items yet.
            {canModify && " Add items for the documents and steps required at renewal time."}
          </p>
        ) : (
          <ul className="space-y-2">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex items-start gap-3 py-1.5 px-2 rounded-md hover:bg-muted/50"
              >
                <input
                  type="checkbox"
                  checked={item.completed}
                  onChange={() => canModify && handleToggle(item.id)}
                  disabled={!canModify || isPending}
                  className="mt-1 h-4 w-4 accent-primary cursor-pointer disabled:cursor-not-allowed"
                />
                <div className="flex-1 min-w-0">
                  <p
                    className={`text-sm ${
                      item.completed ? "line-through text-muted-foreground" : ""
                    }`}
                  >
                    {item.label}
                    {item.required && !item.completed && (
                      <span className="text-destructive ml-1" title="Required">
                        *
                      </span>
                    )}
                  </p>
                  {item.completed && item.completedBy && item.completedAt && (
                    <p className="text-xs text-muted-foreground">
                      Done by {item.completedBy.name} ·{" "}
                      {format(new Date(item.completedAt), "MMM d, yyyy")}
                    </p>
                  )}
                </div>
                {canModify && (
                  <button
                    type="button"
                    onClick={() => handleRemove(item.id)}
                    disabled={isPending}
                    className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                    aria-label="Remove item"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
