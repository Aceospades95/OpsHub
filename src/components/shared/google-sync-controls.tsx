"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { format } from "date-fns";
import { syncGoogleTasksAction, setGoogleAutoSync } from "@/actions/google-tasks";
import { CalendarCheck, RefreshCw } from "lucide-react";

export interface GoogleSyncState {
  connected: boolean;
  lastSyncedAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  /** Client-side auto-sync cadence; 0 = off. */
  autoSyncMinutes: number;
}

const AUTO_SYNC_OPTIONS = [
  { value: 0, label: "Manual" },
  { value: 5, label: "Every 5 min" },
  { value: 15, label: "Every 15 min" },
  { value: 30, label: "Every 30 min" },
  { value: 60, label: "Hourly" },
];

/**
 * Google Tasks controls in one compact row: last-sync status, auto-sync
 * cadence, manual Sync, Disconnect — or the Connect link when the
 * viewer hasn't linked Google yet. Shared by the "My tasks" card on
 * /my and the /tasks page header so the sync options live wherever
 * tasks do. Auto-sync polls from whichever page is open; the
 * per-instance `syncing` guard stops overlapping ticks and the sync
 * itself is idempotent, so both pages open at once is harmless.
 */
export function GoogleSyncControls({ google }: { google: GoogleSyncState }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [syncing, setSyncing] = useState(false);

  async function runSync(silent = false) {
    if (syncing) return;
    setSyncing(true);
    try {
      const result = await syncGoogleTasksAction();
      if (result.error) {
        if (!silent) toast.error(`Sync issue: ${result.error}`);
      } else if (!silent) {
        const pulled = result.pulledCreated + result.pulledUpdated;
        toast.success(
          pulled > 0
            ? `Synced — ${pulled} update${pulled === 1 ? "" : "s"} from Google`
            : "Synced — up to date"
        );
      }
      startTransition(() => router.refresh());
    } catch {
      if (!silent) toast.error("Couldn't reach Google — try again");
    } finally {
      setSyncing(false);
    }
  }

  async function changeInterval(minutes: number) {
    const result = await setGoogleAutoSync(minutes);
    if (result && "error" in result && result.error) {
      toast.error(result.error);
      return;
    }
    startTransition(() => router.refresh());
  }

  // Auto-sync while the page is open, at the chosen cadence. Skips the
  // tick if a manual/previous sync is still running.
  const syncRef = useRef(runSync);
  syncRef.current = runSync;
  useEffect(() => {
    if (!google.connected || !google.autoSyncMinutes) return;
    const ms = google.autoSyncMinutes * 60 * 1000;
    const timer = setInterval(() => syncRef.current(true), ms);
    return () => clearInterval(timer);
  }, [google.connected, google.autoSyncMinutes]);

  if (!google.connected) {
    return (
      <a
        href="/api/integrations/google-tasks/connect"
        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
      >
        <CalendarCheck className="h-3.5 w-3.5" />
        Connect Google Tasks
      </a>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1 min-w-0">
      <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
        <CalendarCheck className="h-3.5 w-3.5" />
        <span>
          {google.lastSyncStatus === "failed"
            ? "Google sync failed"
            : google.lastSyncedAt
              ? `Synced ${format(new Date(google.lastSyncedAt), "MMM d, HH:mm")}`
              : "Google connected"}
        </span>
        <select
          value={google.autoSyncMinutes}
          onChange={(e) => changeInterval(Number(e.target.value))}
          className="px-1.5 py-1 rounded-md border border-input bg-background"
          aria-label="Auto-sync interval"
        >
          {AUTO_SYNC_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => runSync(false)}
          disabled={syncing}
          className="inline-flex items-center gap-1 px-2 py-1 font-medium rounded-md border border-input bg-background hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${syncing ? "animate-spin" : ""}`} />
          Sync
        </button>
        <form action="/api/integrations/google-tasks/disconnect" method="post">
          <button type="submit" className="hover:text-destructive hover:underline">
            Disconnect
          </button>
        </form>
      </div>
      {google.lastSyncStatus === "failed" && google.lastSyncError && (
        <p
          className="text-xs text-destructive max-w-sm truncate"
          title={google.lastSyncError}
          role="alert"
        >
          {google.lastSyncError}
        </p>
      )}
    </div>
  );
}
