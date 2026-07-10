"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { StatusBadge } from "@/components/shared/status-badge";
import { TaskCheckbox } from "./task-checkbox";
import { TaskDrawer, type TaskDrawerTask } from "./task-drawer";
import { formatCalendarDate } from "@/lib/dates";
import { CalendarCheck, Mail } from "lucide-react";

const statusBadgeVariant: Record<string, "default" | "success" | "warning" | "destructive" | "secondary" | "outline"> = {
  TODO: "outline",
  IN_PROGRESS: "default",
  DONE: "success",
  CANCELLED: "secondary",
};

const statusLabels: Record<string, string> = {
  TODO: "To Do",
  IN_PROGRESS: "In Progress",
  DONE: "Done",
  CANCELLED: "Cancelled",
};

interface Props {
  activeTasks: TaskDrawerTask[];
  completedTasks: TaskDrawerTask[];
  projects: { id: string; name: string }[];
  clients: { id: string; name: string }[];
  users: { id: string; name: string }[];
}

/**
 * Client-side wrapper around the active/completed task lists. Owns the
 * drawer-open state so clicking any row title routes through the
 * shared TaskDrawer instead of doing nothing (the QA stress test
 * flagged: "clicking a task row body does NOT open a detail/edit
 * view; only the checkbox toggles status").
 *
 * Active and completed tasks share a single row renderer so their
 * metadata layouts stay aligned — the QA report flagged that the
 * original markup rendered different shapes (active had assignee on
 * the right side, completed had it inline).
 */
export function TasksListClient({
  activeTasks,
  completedTasks,
  projects,
  clients,
  users,
}: Props) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const allTasks = [...activeTasks, ...completedTasks];
  const selectedTask = selectedTaskId
    ? allTasks.find((t) => t.id === selectedTaskId) ?? null
    : null;

  // Deep link: /tasks#task-<id> (from My View rows and assignment
  // notifications) opens that task's drawer on arrival — the browser
  // scrolls to the row's anchor, this opens the detail. Mount-only:
  // closing the drawer must not re-open it on the next render.
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.startsWith("#task-")) return;
    const id = hash.slice("#task-".length);
    if ([...activeTasks, ...completedTasks].some((t) => t.id === id)) {
      setSelectedTaskId(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-8">
      {activeTasks.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-foreground mb-4">
            Active ({activeTasks.length})
          </h2>
          <div className="space-y-2">
            {activeTasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                onOpen={() => setSelectedTaskId(task.id)}
              />
            ))}
          </div>
        </div>
      )}

      {completedTasks.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-muted-foreground mb-4">
            Completed ({completedTasks.length})
          </h2>
          <div className="space-y-2 opacity-60">
            {completedTasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                onOpen={() => setSelectedTaskId(task.id)}
                completed
              />
            ))}
          </div>
        </div>
      )}

      <TaskDrawer
        task={selectedTask}
        projects={projects}
        clients={clients}
        users={users}
        onClose={() => setSelectedTaskId(null)}
      />
    </div>
  );
}

function TaskRow({
  task,
  onOpen,
  completed = false,
}: {
  task: TaskDrawerTask;
  onOpen: () => void;
  completed?: boolean;
}) {
  const isPastDue =
    !completed && task.dueDate && new Date(task.dueDate) < new Date();
  return (
    // The anchor id + scroll margin make /tasks#task-<id> land here
    // (deep links from My View and assignment notifications).
    <Card id={`task-${task.id}`} className="hover:shadow-sm transition-shadow scroll-mt-24">
      <CardContent className="p-4">
        <div className="flex items-center gap-4">
          <TaskCheckbox taskId={task.id} status={task.status} />
          <button
            type="button"
            onClick={onOpen}
            className="flex-1 min-w-0 text-left"
          >
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`font-medium text-foreground ${completed ? "line-through" : ""}`}
                title={task.title}
              >
                {task.title}
              </span>
              {task.isGoogle && (
                <CalendarCheck
                  className="h-3.5 w-3.5 text-muted-foreground shrink-0"
                  aria-label="Synced with Google Tasks"
                />
              )}
              {!completed && <StatusBadge status={task.priority} />}
              {task.status === "IN_PROGRESS" && (
                <Badge variant="default" className="text-xs">
                  In Progress
                </Badge>
              )}
              {completed && (
                <Badge
                  variant={statusBadgeVariant[task.status] ?? "secondary"}
                  className="text-xs"
                >
                  {statusLabels[task.status] ?? task.status}
                </Badge>
              )}
            </div>
            {/* Round-5 QA: dot separators (·) between metadata items
             *  so adjacent strings can never visually run together
             *  even if a gap utility is overridden. The flex
             *  container's gap still applies; the dots are a
             *  belt-and-suspenders signal. */}
            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
              {task.project ? (
                <Link
                  href={`/projects/${task.project.id}`}
                  className="hover:text-primary"
                  onClick={(e) => e.stopPropagation()}
                >
                  {task.project.name}
                </Link>
              ) : (
                <span className="italic opacity-70">No project</span>
              )}
              {task.client && (
                <>
                  <span aria-hidden className="opacity-40">·</span>
                  <Link
                    href={`/clients/${task.client.id}`}
                    className="hover:text-primary"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {task.client.name}
                  </Link>
                </>
              )}
              {/* For active tasks: show the due date (red if past
               *  due). For completed tasks: show "Completed [date]"
               *  so the row isn't a blank space where the due date
               *  used to be. */}
              {!completed && task.dueDate && (
                <>
                  <span aria-hidden className="opacity-40">·</span>
                  <span className={isPastDue ? "text-destructive font-medium" : ""}>
                    Due {formatCalendarDate(task.dueDate, "MMM d, yyyy")}
                  </span>
                </>
              )}
              {completed && (
                <>
                  <span aria-hidden className="opacity-40">·</span>
                  <span>
                    Completed{task.completedAt ? ` ${formatCalendarDate(task.completedAt, "MMM d, yyyy")}` : ""}
                  </span>
                </>
              )}
              {/* Gmail/Docs link Google carries on synced tasks — same
               *  stopPropagation pattern as the project/client links so
               *  it doesn't also open the drawer. */}
              {task.sourceLink && (
                <>
                  <span aria-hidden className="opacity-40">·</span>
                  <a
                    href={task.sourceLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                    aria-label="Open the linked email in Google"
                  >
                    <Mail className="h-3 w-3" />
                    Email
                  </a>
                </>
              )}
            </div>
          </button>
          {task.assignee && (
            <Link
              href={`/team/${task.assignee.id}`}
              className="flex items-center gap-1.5 shrink-0 hover:text-primary"
              onClick={(e) => e.stopPropagation()}
              title={task.assignee.name}
            >
              <Avatar name={task.assignee.name} size="xs" />
              <span className="text-xs text-muted-foreground hover:text-primary hidden sm:inline">
                {task.assignee.name}
              </span>
            </Link>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
