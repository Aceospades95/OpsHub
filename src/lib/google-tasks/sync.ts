/**
 * Google Tasks ⇄ OpsHub sync engine.
 *
 * Sync model:
 *
 *   PULL  — every task in EVERY list on the connected Google account
 *           (the default "My Tasks" list included) becomes an OpsHub
 *           Task assigned to the integration's user. Quick-adds from
 *           any Google surface (app, Assistant, Gmail sidebar) show up
 *           in "My tasks" on /my, where unfiled ones can be dropped
 *           onto a project.
 *   PUSH  — changes to those SAME tasks flow back (title, notes, due,
 *           completion). OpsHub-native tasks are NOT pushed to Google
 *           automatically: your Google lists stay yours, not a mirror
 *           of the org's whole task table (pushNewTaskToGoogle exists
 *           for explicit "send to my phone" flows).
 *
 * `Task.sourceId` stores "<tasklistId>:<taskId>" so pushes know which
 * list to patch. Legacy rows from the retired dedicated-"OpsHub"-list
 * design stored the bare task id — they're migrated to the composite
 * key the first time a pull matches them, and the push path falls back
 * to the stored integration.tasklistId for any stragglers.
 *
 * Conflicts resolve last-write-wins per task using Google's `updated`
 * stamp vs the OpsHub row's updatedAt.
 *
 * Google Tasks has no webhooks, so this runs from the `google-tasks-sync`
 * job (cron) and on demand from the /my "Sync now" button. Both paths are
 * idempotent.
 */

import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { revalidateTask } from "@/lib/revalidate-entity";
import {
  getValidAccessToken,
  insertTask,
  listTasklists,
  listTasks,
  patchTask,
  type GoogleTask,
} from "./api";

const SOURCE_TYPE = "google_tasks";
/** Overlap window so clock skew between us and Google can't drop updates. */
const UPDATED_MIN_BUFFER_MS = 5 * 60 * 1000;

export interface SyncResult {
  pulledCreated: number;
  pulledUpdated: number;
  pushed: number;
  errors: string[];
}

/** Composite source key — Google task ids are only unique per list. */
function sourceKey(tasklistId: string, taskId: string): string {
  return `${tasklistId}:${taskId}`;
}

/** Split a sourceId back into list + task. Legacy bare ids have no list. */
function parseSourceId(sourceId: string): { tasklistId: string | null; taskId: string } {
  const i = sourceId.indexOf(":");
  if (i === -1) return { tasklistId: null, taskId: sourceId };
  return { tasklistId: sourceId.slice(0, i), taskId: sourceId.slice(i + 1) };
}

/** Google `due` is date-only; normalize both sides to a YYYY-MM-DD string. */
function dueKey(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const iso = typeof value === "string" ? value : value.toISOString();
  return iso.slice(0, 10);
}

function googleStatusToOps(status: string | undefined): "TODO" | "DONE" {
  return status === "completed" ? "DONE" : "TODO";
}

/** The email/doc link Google carries on the task, if any. */
function sourceLinkOf(g: GoogleTask): string | null {
  return g.links?.find((l) => l.link)?.link ?? null;
}

/**
 * True when Google won't accept writes back to this task. "Assigned"
 * tasks (from Chat/Docs, they carry assignmentInfo) and some
 * Gmail-linked tasks return 403 PERMISSION_DENIED on PATCH — we pull
 * them read-only rather than error every sync trying to push.
 */
function isReadOnly(g: GoogleTask): boolean {
  return Boolean(g.assignmentInfo);
}

export async function syncGoogleTasksForUser(userId: string): Promise<SyncResult> {
  const result: SyncResult = { pulledCreated: 0, pulledUpdated: 0, pushed: 0, errors: [] };

  const integration = await db.googleTasksIntegration.findUnique({ where: { userId } });
  if (!integration) {
    result.errors.push("Not connected");
    return result;
  }

  // High-water mark BEFORE any network calls — anything that changes
  // mid-sync gets re-examined next run instead of slipping through.
  const syncStartedAt = new Date();

  try {
    const accessToken = await getValidAccessToken(integration);

    // ── PULL: Google → OpsHub, across every list on the account ──
    const updatedMin = integration.lastSyncedAt
      ? new Date(integration.lastSyncedAt.getTime() - UPDATED_MIN_BUFFER_MS)
      : null;
    const lists = await listTasklists(accessToken);

    // Tasks whose OpsHub row was written by THIS pull — the push phase
    // skips them so a pull-write doesn't echo straight back to Google.
    const pulledIds = new Set<string>();

    for (const list of lists) {
      let googleTasks: GoogleTask[];
      try {
        googleTasks = await listTasks(accessToken, list.id, updatedMin);
      } catch (err) {
        result.errors.push(`list ${list.title ?? list.id}: ${(err as Error).message}`);
        continue;
      }

      for (const g of googleTasks) {
        const key = sourceKey(list.id, g.id);
        try {
          // Match the composite key, falling back to the legacy bare id
          // (pre-multi-list rows) which gets migrated on first touch.
          const existing = await db.task.findFirst({
            where: { sourceType: SOURCE_TYPE, sourceId: { in: [key, g.id] } },
          });

          if (!existing) {
            if (g.deleted || !g.title?.trim()) continue;
            await db.task.create({
              data: {
                title: g.title.trim().slice(0, 500),
                description: g.notes?.trim() || null,
                status: googleStatusToOps(g.status),
                completedAt: g.status === "completed" ? new Date(g.completed ?? Date.now()) : null,
                dueDate: g.due ? new Date(g.due) : null,
                assigneeId: userId,
                createdById: userId,
                sourceType: SOURCE_TYPE,
                sourceId: key,
                sourceLink: sourceLinkOf(g),
                sourceReadOnly: isReadOnly(g),
              },
            });
            pulledIds.add(key);
            result.pulledCreated += 1;
            continue;
          }

          // Deletion in Google soft-deletes here (recoverable from the bin).
          if (g.deleted) {
            if (!existing.deletedAt) {
              await db.task.update({
                where: { id: existing.id },
                data: { deletedAt: new Date(), sourceId: key },
              });
              pulledIds.add(key);
              result.pulledUpdated += 1;
            }
            continue;
          }

          // Last-write-wins: only apply when Google's edit is newer than
          // the OpsHub row. Ties (equal stamps) mean "already in sync".
          const googleUpdated = g.updated ? new Date(g.updated) : null;
          if (!googleUpdated || googleUpdated.getTime() <= existing.updatedAt.getTime()) {
            // Still migrate a legacy sourceId so future pushes know the list.
            if (existing.sourceId !== key) {
              await db.task.update({ where: { id: existing.id }, data: { sourceId: key } });
            }
            continue;
          }

          const nextStatus = googleStatusToOps(g.status);
          const nextLink = sourceLinkOf(g);
          const nextReadOnly = isReadOnly(g);
          const changed =
            existing.title !== (g.title?.trim() || existing.title) ||
            (existing.description ?? "") !== (g.notes?.trim() ?? "") ||
            dueKey(existing.dueDate) !== dueKey(g.due) ||
            // Don't clobber IN_PROGRESS with TODO — Google only knows
            // needsAction/completed, so "not completed" must preserve the
            // richer OpsHub status.
            (nextStatus === "DONE") !== (existing.status === "DONE") ||
            existing.deletedAt !== null ||
            existing.sourceId !== key ||
            existing.sourceLink !== nextLink ||
            existing.sourceReadOnly !== nextReadOnly;

          if (!changed) continue;

          await db.task.update({
            where: { id: existing.id },
            data: {
              title: g.title?.trim() ? g.title.trim().slice(0, 500) : existing.title,
              description: g.notes?.trim() || null,
              dueDate: g.due ? new Date(g.due) : null,
              sourceId: key,
              sourceLink: nextLink,
              sourceReadOnly: nextReadOnly,
              ...(nextStatus === "DONE"
                ? { status: "DONE", completedAt: new Date(g.completed ?? Date.now()) }
                : existing.status === "DONE"
                  ? { status: "TODO", completedAt: null }
                  : {}),
              deletedAt: null,
            },
          });
          pulledIds.add(key);
          result.pulledUpdated += 1;
        } catch (err) {
          result.errors.push(`pull ${key}: ${(err as Error).message}`);
        }
      }
    }

    // ── PUSH: OpsHub → Google (synced tasks only) ────────────────
    const pushSince = integration.lastSyncedAt
      ? new Date(integration.lastSyncedAt.getTime() - UPDATED_MIN_BUFFER_MS)
      : null;
    const changedLocal = await db.task.findMany({
      where: {
        sourceType: SOURCE_TYPE,
        assigneeId: userId,
        // Read-only tasks (assigned / Gmail-linked) never push — Google
        // 403s on them. We pull them; we don't fight the API to write back.
        sourceReadOnly: false,
        ...(pushSince ? { updatedAt: { gt: pushSince } } : {}),
      },
    });

    for (const task of changedLocal) {
      if (!task.sourceId || pulledIds.has(task.sourceId)) continue;
      const { tasklistId, taskId } = parseSourceId(task.sourceId);
      // Legacy rows without a list prefix fall back to the old
      // dedicated-list id; "@default" resolves to the account's main list.
      const targetList = tasklistId ?? integration.tasklistId ?? "@default";
      try {
        await patchTask(accessToken, targetList, taskId, {
          title: task.title,
          notes: task.description ?? "",
          due: task.dueDate ? task.dueDate.toISOString() : undefined,
          ...(task.status === "DONE" || task.status === "CANCELLED"
            ? { status: "completed", completed: (task.completedAt ?? new Date()).toISOString() }
            : { status: "needsAction" }),
        });
        result.pushed += 1;
      } catch (err) {
        const status = (err as Error & { status?: number }).status;
        // 404 = deleted on the Google side and already past the pull
        // window — mirror the delete here rather than erroring forever.
        if (status === 404 && !task.deletedAt) {
          await db.task.update({ where: { id: task.id }, data: { deletedAt: new Date() } });
        } else if (status === 403) {
          // Google won't let us write this task (assigned / Gmail-linked).
          // Flag it read-only so future syncs skip the push — NOT an
          // error; the sync stays "success". The completion/edit still
          // lives correctly in OpsHub; it just can't round-trip.
          await db.task.update({ where: { id: task.id }, data: { sourceReadOnly: true } });
        } else if (status !== 404) {
          result.errors.push(`push ${task.id}: ${(err as Error).message}`);
        }
      }
    }

    await db.googleTasksIntegration.update({
      where: { id: integration.id },
      data: {
        lastSyncedAt: syncStartedAt,
        lastSyncStatus: result.errors.length > 0 ? "failed" : "success",
        lastSyncError: result.errors.length > 0 ? result.errors.slice(0, 5).join("\n") : null,
      },
    });

    if (result.pulledCreated > 0 || result.pulledUpdated > 0) {
      // Synced tasks surface on /my, /tasks, and the dashboard.
      revalidateTask({ assigneeId: userId });
    }
  } catch (err) {
    const message = (err as Error).message;
    log.error("google-tasks", "Sync failed", err);
    result.errors.push(message);
    await db.googleTasksIntegration
      .update({
        where: { id: integration.id },
        data: { lastSyncStatus: "failed", lastSyncError: message.slice(0, 1000) },
      })
      .catch(() => {});
  }

  return result;
}

/**
 * Push a brand-new OpsHub task INTO Google (the account's default
 * list). Not part of the periodic sync (OpsHub-native tasks stay
 * native) — this is for explicit flows that want a task on the owner's
 * phone, e.g. a future "send to my Google Tasks" row action.
 */
export async function pushNewTaskToGoogle(userId: string, taskId: string): Promise<{ error?: string }> {
  const integration = await db.googleTasksIntegration.findUnique({ where: { userId } });
  if (!integration) return { error: "Google Tasks is not connected" };

  const task = await db.task.findFirst({ where: { id: taskId, deletedAt: null } });
  if (!task) return { error: "Task not found" };
  if (task.sourceType === SOURCE_TYPE) return {}; // already mirrored

  const accessToken = await getValidAccessToken(integration);
  const created: GoogleTask = await insertTask(accessToken, "@default", {
    title: task.title,
    notes: task.description ?? undefined,
    due: task.dueDate ? task.dueDate.toISOString() : undefined,
  });
  await db.task.update({
    where: { id: task.id },
    data: { sourceType: SOURCE_TYPE, sourceId: sourceKey("@default", created.id) },
  });
  return {};
}
