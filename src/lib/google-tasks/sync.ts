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
 * Push ownership is by LIST, not by assignee: this integration's token
 * can only write lists on THIS Google account, and a synced task
 * reassigned to another OpsHub user still lives in the original
 * owner's list. (Keying the push on assigneeId used to make the new
 * assignee's sync patch a foreign list → 404 → the delete-mirroring
 * path silently soft-deleted the task.)
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
  getDefaultTasklist,
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
    //
    // Normally incremental (updatedMin window). One FULL pass runs when
    // fullPulledAt is null: incremental pulls never revisit unchanged
    // tasks, so fields added later (sourceLink, sourceReadOnly) would
    // otherwise stay empty on rows pulled before the field existed —
    // "the email link doesn't show on my old tasks".
    const needsFullPull = !integration.fullPulledAt;
    const updatedMin =
      !needsFullPull && integration.lastSyncedAt
        ? new Date(integration.lastSyncedAt.getTime() - UPDATED_MIN_BUFFER_MS)
        : null;
    const lists = await listTasklists(accessToken);

    // The default list's REAL id — the push phase needs it to know
    // which alias-keyed rows are ours. Non-fatal when it can't resolve:
    // the "@default" alias fallbacks below still work for API calls.
    let defaultListId: string | null = null;
    try {
      defaultListId = (await getDefaultTasklist(accessToken)).id;
    } catch {
      /* alias fallback below */
    }

    // ── Mirror the account's lists (names power grouping/badges and
    // the send-to-Google picker; the fetch above is already paid for).
    // A mirror row whose list vanished from the account means the list
    // was deleted in Google — mirror that: soft-delete its tasks
    // (recoverable from the bin) and drop the mirror row.
    const liveListIds = new Set(lists.map((l) => l.id));
    for (const list of lists) {
      await db.googleTaskList.upsert({
        where: { userId_listId: { userId, listId: list.id } },
        create: {
          userId,
          listId: list.id,
          title: list.title?.trim() || "Untitled list",
          isDefault: defaultListId != null && list.id === defaultListId,
          lastSeenAt: syncStartedAt,
        },
        update: {
          title: list.title?.trim() || "Untitled list",
          ...(defaultListId != null ? { isDefault: list.id === defaultListId } : {}),
          lastSeenAt: syncStartedAt,
        },
      });
    }
    const goneLists = await db.googleTaskList.findMany({
      where: { userId, listId: { notIn: Array.from(liveListIds) } },
    });
    for (const gone of goneLists) {
      const orphaned = await db.task.updateMany({
        where: {
          sourceType: SOURCE_TYPE,
          sourceId: { startsWith: `${gone.listId}:` },
          deletedAt: null,
        },
        data: { deletedAt: new Date() },
      });
      if (orphaned.count > 0) result.pulledUpdated += orphaned.count;
      await db.googleTaskList.delete({ where: { id: gone.id } });
      log.info("google-tasks", "List deleted in Google — mirrored", {
        userId,
        listId: gone.listId,
        tasksSoftDeleted: orphaned.count,
      });
    }

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
          // (pre-multi-list rows) and the "@default:<id>" alias key
          // (rows pushNewTaskToGoogle wrote before it resolved real
          // list ids). Both legacy shapes migrate to the composite key
          // on first touch — without the alias candidate, a task pushed
          // to Google re-imported as a DUPLICATE row on the next pull.
          const existing = await db.task.findFirst({
            where: {
              sourceType: SOURCE_TYPE,
              sourceId: { in: [key, g.id, sourceKey("@default", g.id)] },
            },
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
                googleListId: list.id,
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
            // Still refresh sync METADATA (not user content), even when
            // Google's edit isn't newer:
            //   - migrate legacy/alias source keys so future pushes know
            //     the list — and since a wrong key is how a row ends up
            //     frozen by the push's conservative 404 handling,
            //     re-derive the read-only flag on migration so it thaws
            //     (rows whose key already matches keep their flag: a
            //     403-frozen task must NOT be retried every sync);
            //   - backfill sourceLink (the Gmail/Docs link) — rows pulled
            //     before the field existed have null here, and the full
            //     pull walks them exactly once to fix that.
            // Deliberately NOT added to pulledIds — an OpsHub-newer row
            // should still push.
            const metaPatch: {
              sourceId?: string;
              sourceReadOnly?: boolean;
              sourceLink?: string | null;
              googleListId?: string;
            } = {};
            if (existing.sourceId !== key) {
              metaPatch.sourceId = key;
              metaPatch.sourceReadOnly = isReadOnly(g);
            }
            if (existing.googleListId !== list.id) {
              metaPatch.googleListId = list.id;
            }
            if (existing.sourceLink !== sourceLinkOf(g)) {
              metaPatch.sourceLink = sourceLinkOf(g);
            }
            if (Object.keys(metaPatch).length > 0) {
              await db.task.update({ where: { id: existing.id }, data: metaPatch });
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
              googleListId: list.id,
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

    // ── PUSH: OpsHub → Google (tasks in THIS account's lists) ────
    //
    // Selected by list ownership, not assignee — see the header note.
    // A task in my list stays pushable by MY sync even after it's
    // reassigned to a teammate in OpsHub, and their sync never tries
    // to patch (or 404-delete) a list it can't reach.
    const pushSince = integration.lastSyncedAt
      ? new Date(integration.lastSyncedAt.getTime() - UPDATED_MIN_BUFFER_MS)
      : null;
    const myListIds = new Set(lists.map((l) => l.id));
    if (defaultListId) myListIds.add(defaultListId);
    const changedLocal = await db.task.findMany({
      where: {
        sourceType: SOURCE_TYPE,
        // Read-only tasks (assigned / Gmail-linked) never push — Google
        // 403s on them. We pull them; we don't fight the API to write back.
        sourceReadOnly: false,
        ...(pushSince ? { updatedAt: { gt: pushSince } } : {}),
        OR: [
          // Composite keys naming one of this account's lists.
          ...Array.from(myListIds, (id) => ({ sourceId: { startsWith: `${id}:` } })),
          // Alias ("@default:") and legacy bare keys can't name their
          // list — only the assignee's own sync touches those, resolved
          // against this account with conservative 404 handling below.
          { assigneeId: userId, sourceId: { startsWith: "@default:" } },
          { assigneeId: userId, NOT: { sourceId: { contains: ":" } } },
        ],
      },
    });

    for (const task of changedLocal) {
      if (!task.sourceId || pulledIds.has(task.sourceId)) continue;
      const { tasklistId, taskId } = parseSourceId(task.sourceId);
      // Alias/legacy keys resolve against this account's default list
      // (or the retired dedicated list for bare legacy ids).
      const aliased = tasklistId === null || tasklistId === "@default";
      const targetList = !aliased
        ? tasklistId
        : tasklistId === "@default"
          ? defaultListId ?? "@default"
          : integration.tasklistId ?? defaultListId ?? "@default";
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
        // The successful patch proves the task lives in targetList —
        // pin the real composite key so this row stops depending on
        // alias resolution (and other accounts can recognize it as
        // not-theirs).
        if (aliased && targetList !== "@default") {
          await db.task.update({
            where: { id: task.id },
            data: { sourceId: sourceKey(targetList, taskId), googleListId: targetList },
          });
        }
      } catch (err) {
        const status = (err as Error & { status?: number }).status;
        if (status === 404) {
          // Gone from a list we KNOW is ours → mirror the deletion
          // (recoverable from the bin). Alias/legacy rows might really
          // live somewhere this resolution didn't pick — freeze their
          // pushes instead of deleting; the next pull re-links the row
          // (and clears the flag) if the task still exists anywhere.
          if (!aliased && !task.deletedAt) {
            await db.task.update({ where: { id: task.id }, data: { deletedAt: new Date() } });
          } else if (aliased) {
            await db.task.update({ where: { id: task.id }, data: { sourceReadOnly: true } });
          }
        } else if (status === 403) {
          // Google won't let us write this task (assigned / Gmail-linked).
          // Flag it read-only so future syncs skip the push — NOT an
          // error; the sync stays "success". The completion/edit still
          // lives correctly in OpsHub; it just can't round-trip.
          await db.task.update({ where: { id: task.id }, data: { sourceReadOnly: true } });
        } else {
          result.errors.push(`push ${task.id}: ${(err as Error).message}`);
        }
      }
    }

    await db.googleTasksIntegration.update({
      where: { id: integration.id },
      data: {
        lastSyncedAt: syncStartedAt,
        // Stamp the full pass only when it ran clean — a partial full
        // pull (some list errored) retries next sync.
        ...(needsFullPull && result.errors.length === 0 ? { fullPulledAt: syncStartedAt } : {}),
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
 * Push a brand-new OpsHub task INTO Google. Not part of the periodic
 * sync (OpsHub-native tasks stay native) — this is for explicit flows
 * that want a task on the owner's phone.
 *
 * `targetListId` picks the destination list (from the GoogleTaskList
 * mirror); omitted, it goes to the account's default "My Tasks" —
 * matching where Google's own quick-add puts things.
 */
export async function pushNewTaskToGoogle(
  userId: string,
  taskId: string,
  targetListId?: string
): Promise<{ error?: string }> {
  const integration = await db.googleTasksIntegration.findUnique({ where: { userId } });
  if (!integration) return { error: "Google Tasks is not connected" };

  const task = await db.task.findFirst({ where: { id: taskId, deletedAt: null } });
  if (!task) return { error: "Task not found" };
  if (task.sourceType === SOURCE_TYPE) return {}; // already mirrored

  // Only accept destinations the mirror knows belong to this account —
  // a stale/foreign id degrades to the default list instead of erroring.
  let listId: string | null = null;
  if (targetListId) {
    const known = await db.googleTaskList.findUnique({
      where: { userId_listId: { userId, listId: targetListId } },
      select: { listId: true },
    });
    listId = known?.listId ?? null;
  }

  const accessToken = await getValidAccessToken(integration);
  if (!listId) {
    // Resolve the default list's REAL id before inserting. Storing the
    // "@default" alias key was a duplicate-task bug: the next pull keys
    // tasks by real list id, never matches the alias row, and re-imports
    // the freshly pushed task as a second OpsHub row.
    listId = "@default";
    try {
      listId = (await getDefaultTasklist(accessToken)).id;
    } catch {
      /* alias still works for the insert; sync's alias handling covers the rest */
    }
  }
  const created: GoogleTask = await insertTask(accessToken, listId, {
    title: task.title,
    notes: task.description ?? undefined,
    due: task.dueDate ? task.dueDate.toISOString() : undefined,
  });
  await db.task.update({
    where: { id: task.id },
    data: {
      sourceType: SOURCE_TYPE,
      sourceId: sourceKey(listId, created.id),
      ...(listId !== "@default" ? { googleListId: listId } : {}),
    },
  });
  return {};
}
