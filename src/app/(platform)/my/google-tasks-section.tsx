"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { assignTaskProject } from "@/actions/tasks";
import { TaskCheckbox } from "@/app/(platform)/tasks/task-checkbox";
import { CalendarCheck, RefreshCw, Inbox } from "lucide-react";

interface InboxTask {
  id: string;
  title: string;
  status: string;
  /** ISO string or null. */
  dueDate: string | null;
}

/**
 * Google Tasks on /my. Two states:
 *
 *  - Not connected: a connect card. The link starts the OAuth consent at
 *    /api/integrations/google-tasks/connect (redirects to Google, then
 *    back here with ?google=connected|error).
 *  - Connected: the triage inbox — tasks that arrived from Google and
 *    aren't filed under a project yet. Each row has a project picker;
 *    filing calls assignTaskProject. "Sync now" posts to the sync route
 *    which pulls/pushes and redirects back.
 *
 * The buttons deliberately target route URLs (full-page form posts), not
 * server actions, so this section has no dependency on the integration
 * actions module and degrades to a 404 if the routes are absent.
 */
const FLASH_MESSAGES: Record<string, { tone: "success" | "error"; text: string }> = {
  connected: { tone: "success", text: "Google Tasks connected — your list synced." },
  denied: { tone: "error", text: "Google connection was cancelled." },
  error: { tone: "error", text: "Connecting Google Tasks failed — try again." },
  unconfigured: {
    tone: "error",
    text: "Google OAuth isn't configured — set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (see .env.example).",
  },
};

export function GoogleTasksSection({
  connected,
  flash,
  lastSyncedAt,
  lastSyncStatus,
  lastSyncError,
  inbox,
  projects,
}: {
  connected: boolean;
  /** ?google=… flag set by the OAuth callback redirect. */
  flash: string | null;
  lastSyncedAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  inbox: InboxTask[];
  projects: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [filed, setFiled] = useState<Set<string>>(new Set());

  async function fileUnder(taskId: string, projectId: string) {
    if (!projectId) return;
    const result = await assignTaskProject(taskId, projectId);
    if (result && "error" in result) {
      toast.error(result.error);
      return;
    }
    setFiled((s) => new Set(s).add(taskId));
    startTransition(() => router.refresh());
  }

  const flashMessage = flash ? FLASH_MESSAGES[flash] ?? null : null;
  const flashBanner = flashMessage ? (
    <p
      className={`text-xs mb-3 ${flashMessage.tone === "success" ? "text-success" : "text-destructive"}`}
      role="status"
    >
      {flashMessage.text}
    </p>
  ) : null;

  if (!connected) {
    return (
      <Card className="mb-6">
        <CardContent className="p-6 flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <CalendarCheck className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="font-medium text-sm">Connect Google Tasks</p>
              <p className="text-xs text-muted-foreground">
                Quick-add tasks in Google and triage them here — completions sync both ways.
              </p>
              {flashBanner}
            </div>
          </div>
          <a
            href="/api/integrations/google-tasks/connect"
            className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:opacity-90"
          >
            Connect
          </a>
        </CardContent>
      </Card>
    );
  }

  const visibleInbox = inbox.filter((t) => !filed.has(t.id));

  return (
    <Card className="mb-6">
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <CardTitle className="flex items-center gap-2">
            <Inbox className="h-4 w-4" />
            Google Tasks inbox ({visibleInbox.length})
          </CardTitle>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              {lastSyncStatus === "failed"
                ? "Last sync failed"
                : lastSyncedAt
                  ? `Synced ${format(new Date(lastSyncedAt), "MMM d, HH:mm")}`
                  : "Not synced yet"}
            </span>
            <form action="/api/integrations/google-tasks/sync" method="post">
              <button
                type="submit"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border border-input bg-background hover:bg-muted"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Sync now
              </button>
            </form>
            <form action="/api/integrations/google-tasks/disconnect" method="post">
              <button
                type="submit"
                className="text-xs text-muted-foreground hover:text-destructive hover:underline"
              >
                Disconnect
              </button>
            </form>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {flashBanner}
        {lastSyncStatus === "failed" && lastSyncError && (
          <p className="text-xs text-destructive mb-3" role="alert">
            {lastSyncError}
          </p>
        )}
        {visibleInbox.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Inbox zero — new tasks you add in Google Tasks land here for filing.
          </p>
        ) : (
          <div className="space-y-2">
            {visibleInbox.map((t) => (
              <div key={t.id} className="flex items-center gap-3 text-sm">
                <TaskCheckbox taskId={t.id} status={t.status} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">{t.title}</p>
                  {t.dueDate && (
                    <p className="text-xs text-muted-foreground">
                      Due {format(new Date(t.dueDate), "MMM d")}
                    </p>
                  )}
                </div>
                <select
                  defaultValue=""
                  onChange={(e) => fileUnder(t.id, e.target.value)}
                  className="px-2 py-1 text-xs border border-input rounded-md bg-background max-w-[12rem] shrink-0"
                  aria-label={`File "${t.title}" under a project`}
                >
                  <option value="" disabled>
                    File under project…
                  </option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
