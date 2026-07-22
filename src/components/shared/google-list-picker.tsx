"use client";

/**
 * Destination picker for "also add to Google Tasks" — offers the
 * current user's Google lists (from the sync's mirror) so a task can
 * land in e.g. "Site visits" instead of always My Tasks.
 *
 * Renders nothing when the user has no mirrored lists (not connected,
 * or first sync hasn't run). The selection only applies when assigning
 * to yourself — assigning to someone else always targets their default
 * list (their personal list names stay private), which the server
 * enforces regardless of what this field submits.
 */

import { useEffect, useState } from "react";
import { Select } from "@/components/ui/select";
import { getMyGoogleTaskLists } from "@/actions/google-tasks";

export function GoogleListPicker() {
  const [lists, setLists] = useState<
    { listId: string; title: string; isDefault: boolean }[]
  >([]);

  useEffect(() => {
    let cancelled = false;
    getMyGoogleTaskLists()
      .then((res) => {
        if (!cancelled) setLists(res.lists);
      })
      .catch(() => {
        /* not connected / transient — the picker just stays hidden */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (lists.length === 0) return null;

  return (
    <div>
      <Select
        name="googleListId"
        label="Google list (when assigning to yourself)"
        options={[
          { label: "Default list", value: "" },
          ...lists.map((l) => ({
            label: l.isDefault ? `${l.title} (default)` : l.title,
            value: l.listId,
          })),
        ]}
      />
      <p className="text-[10px] text-muted-foreground mt-1">
        Someone else&apos;s task always goes to their default list.
      </p>
    </div>
  );
}
