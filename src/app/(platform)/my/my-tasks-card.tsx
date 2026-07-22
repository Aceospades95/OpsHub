"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { assignTaskProject } from "@/actions/tasks";
import { TaskCheckbox } from "@/app/(platform)/tasks/task-checkbox";
import {
  GoogleSyncControls,
  type GoogleSyncState,
} from "@/components/shared/google-sync-controls";
import { formatCalendarDate } from "@/lib/dates";
import { MyQuickAddTask } from "./my-quick-add-task";
import { CheckSquare, Clock, CalendarCheck, Mail } from "lucide-react";

export interface MyTaskRow {
  id: string;
  title: string;
  status: string;
  /** ISO string or null. */
  dueDate: string | null;
  project: { id: string; name: string } | null;
  /** True when the task is synced with the user's Google Tasks. */
  isGoogle: boolean;
  /** Gmail/Docs link Google carries on the task, if any. */
  sourceLink: string | null;
  /** Google list name (null for OpsHub-native tasks). */
  listTitle: string | null;
  /** True when the task's list is the account default ("My Tasks"). */
  listIsDefault: boolean;
}

const FLASH_MESSAGES: Record<string, { tone: "success" | "error"; text: string }> = {
  connected: { tone: "success", text: "Google Tasks connected — your lists synced." },
  denied: { tone: "error", text: "Google connection was cancelled." },
  error: { tone: "error", text: "Connecting Google Tasks failed — try again." },
  unconfigured: {
    tone: "error",
    text: "Google OAuth isn't configured — set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (see .env.example).",
  },
};

/**
 * The one task list on /my: OpsHub tasks and Google-synced tasks
 * together, soonest due first. Google is plumbing, not a place — a
 * small mark on synced rows, connect/sync controls in the header
 * (shared GoogleSyncControls, also on /tasks), and any task without a
 * project (from either side) can be filed onto one inline. Titles
 * deep-link to /tasks#task-<id>, which opens the task's drawer there.
 */
export function MyTasksCard({
  tasks,
  projects,
  google,
  flash,
  assigneeId,
  now,
}: {
  tasks: MyTaskRow[];
  projects: { id: string; name: string }[];
  google: GoogleSyncState;
  /** ?google=… flag set by the OAuth callback redirect. */
  flash: string | null;
  assigneeId: string;
  /** Server render time (ISO) — keeps overdue math SSR-stable. */
  now: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [filed, setFiled] = useState<Map<string, string>>(new Map());
  // Google-style grouping: one section per Google list (default list
  // first), OpsHub-native tasks as their own section. Sticky per
  // browser, mirroring how the Google Tasks app organizes things.
  const [groupByList, setGroupByList] = useState(false);
  useEffect(() => {
    setGroupByList(localStorage.getItem("ohview.my-tasks-group") === "list");
  }, []);
  const hasGoogleTasks = tasks.some((t) => t.isGoogle);
  function setGrouping(byList: boolean) {
    setGroupByList(byList);
    localStorage.setItem("ohview.my-tasks-group", byList ? "list" : "due");
  }
  const renderedAt = new Date(now);

  async function fileUnder(taskId: string, projectId: string) {
    if (!projectId) return;
    const result = await assignTaskProject(taskId, projectId);
    if (result && "error" in result) {
      toast.error(result.error);
      return;
    }
    const name = projects.find((p) => p.id === projectId)?.name ?? "project";
    setFiled((m) => new Map(m).set(taskId, name));
    startTransition(() => router.refresh());
  }

  const flashMessage = flash ? FLASH_MESSAGES[flash] ?? null : null;

  const renderTask = (task: MyTaskRow) => {
              const overdue = task.dueDate ? new Date(task.dueDate) < renderedAt : false;
              const filedName = filed.get(task.id);
              return (
                <div key={task.id} className="flex items-start gap-3 text-sm">
                  <TaskCheckbox taskId={task.id} status={task.status} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate flex items-center gap-1.5">
                      <Link
                        href={`/tasks#task-${task.id}`}
                        className="truncate hover:text-primary hover:underline"
                        title={`Open "${task.title}" on the tasks page`}
                      >
                        {task.title}
                      </Link>
                      {task.isGoogle && (
                        <CalendarCheck
                          className="h-3 w-3 text-muted-foreground shrink-0"
                          aria-label="Synced with Google Tasks"
                        />
                      )}
                      {task.isGoogle && task.listTitle && !groupByList && (
                        <span
                          className="text-[10px] text-muted-foreground bg-muted rounded px-1 py-px shrink-0"
                          title={`Google list: ${task.listTitle}`}
                        >
                          {task.listTitle}
                        </span>
                      )}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                      {task.project ? (
                        <Link
                          href={`/projects/${task.project.id}`}
                          className="hover:text-primary hover:underline truncate"
                        >
                          {task.project.name}
                        </Link>
                      ) : filedName ? (
                        <span className="truncate">{filedName}</span>
                      ) : (
                        <select
                          defaultValue=""
                          onChange={(e) => fileUnder(task.id, e.target.value)}
                          className="px-1.5 py-0.5 border border-input rounded bg-background max-w-[11rem]"
                          aria-label={`File "${task.title}" under a project`}
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
                      )}
                      {task.dueDate && (
                        <span className={`flex items-center gap-1 shrink-0 ${overdue ? "text-destructive" : ""}`}>
                          <Clock className="h-3 w-3" />
                          {formatCalendarDate(task.dueDate, "MMM d")}
                        </span>
                      )}
                      {task.sourceLink && (
                        <a
                          href={task.sourceLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 shrink-0 text-primary hover:underline"
                          aria-label="Open the linked email in Google"
                        >
                          <Mail className="h-3 w-3" />
                          Email
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              );
  };

  const groups = groupByList
    ? (() => {
        const out: { title: string; tasks: MyTaskRow[] }[] = [];
        const ops = tasks.filter((t) => !t.isGoogle);
        if (ops.length > 0) out.push({ title: "OpsHub", tasks: ops });
        const byList = new Map<string, { isDefault: boolean; tasks: MyTaskRow[] }>();
        for (const t of tasks) {
          if (!t.isGoogle) continue;
          const key = t.listTitle ?? "Google Tasks";
          const g = byList.get(key) ?? { isDefault: t.listIsDefault, tasks: [] };
          g.isDefault = g.isDefault || t.listIsDefault;
          g.tasks.push(t);
          byList.set(key, g);
        }
        const google = Array.from(byList.entries())
          .sort(
            (a, b) =>
              Number(b[1].isDefault) - Number(a[1].isDefault) || a[0].localeCompare(b[0])
          )
          .map(([title, g]) => ({ title, tasks: g.tasks }));
        return [...out, ...google];
      })()
    : [];



  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="flex items-center gap-2">
            <CheckSquare className="h-4 w-4" />
            My tasks ({tasks.length})
          </CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            {hasGoogleTasks && (
              <div
                className="flex rounded border border-border overflow-hidden text-[11px]"
                role="group"
                aria-label="Task grouping"
              >
                <button
                  type="button"
                  onClick={() => setGrouping(false)}
                  className={`px-2 py-1 ${!groupByList ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/50"}`}
                >
                  Due date
                </button>
                <button
                  type="button"
                  onClick={() => setGrouping(true)}
                  className={`px-2 py-1 ${groupByList ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/50"}`}
                >
                  By list
                </button>
              </div>
            )}
            <GoogleSyncControls google={google} />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {flashMessage && (
          <p
            className={`text-xs mb-3 ${flashMessage.tone === "success" ? "text-success" : "text-destructive"}`}
            role="status"
          >
            {flashMessage.text}
          </p>
        )}

        <MyQuickAddTask projects={projects} assigneeId={assigneeId} />

        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground mt-3">
            No open tasks{google.connected ? " — quick-adds in Google land here after a sync" : ""}.
          </p>
        ) : (
          groupByList ? (
            <div className="space-y-4 mt-3">
              {groups.map((g) => (
                <div key={g.title}>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                    {g.title} ({g.tasks.length})
                  </p>
                  <div className="space-y-2">{g.tasks.map(renderTask)}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2 mt-3">{tasks.map(renderTask)}</div>
          )
        )}
      </CardContent>
    </Card>
  );
}
