"use server";

import { db } from "@/lib/db";
import { requireAuth } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { revalidatePath } from "next/cache";
import { revalidateUser } from "@/lib/revalidate-entity";
import { executeMerge, REASSIGNMENTS } from "@/lib/merge-users-fk";

/**
 * Server action backing the back-office "Merge Employees" admin UI.
 *
 * Wraps the same FK-walk used by the npm-script merge tools (see
 * prisma/lib/merge-users-fk.ts). The UI is the third entry-point
 * alongside `merge-duplicate-users.ts` (auto-find by email) and
 * `merge-users-by-id.ts` (operator picks ids); they all share one
 * implementation so a fix to the reassignment recipe lands everywhere.
 *
 * The action defaults to dry-run preview. The UI surfaces a separate
 * "Commit" button that posts dryRun=false; that button is the only
 * path that mutates rows. We never run the merge as a side-effect of
 * loading the page.
 */

export interface MergePreviewItem {
  id: string;
  name: string;
  email: string;
  role: string;
  jobTitle: string | null;
  department: string | null;
  isActive: boolean;
  attachmentCount: number;
  createdAt: string;
}

export interface MergeUsersResult {
  ok: boolean;
  /** Filled when ok = false. */
  error?: string;
  /** Filled on dry-run AND on a successful commit, so the UI can show
   *  the same summary screen for "what would happen" vs "what just
   *  happened". */
  preview?: {
    from: MergePreviewItem;
    to: MergePreviewItem;
    /** Total FK columns the script will walk. */
    columnsToReassign: number;
    /** Optional rename of the keeper email applied AFTER the FK walk. */
    targetEmail: string | null;
  };
  /** True only after a successful live commit. */
  committed?: boolean;
}

async function loadPreviewItem(id: string): Promise<MergePreviewItem | null> {
  const u = await db.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      jobTitle: true,
      department: true,
      isActive: true,
      createdAt: true,
      _count: {
        select: {
          assignments: true,
          projectMembers: true,
          assignedTasks: true,
          createdTasks: true,
          comments: true,
          activityLogs: true,
        },
      },
    },
  });
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    jobTitle: u.jobTitle,
    department: u.department,
    isActive: u.isActive,
    createdAt: u.createdAt.toISOString(),
    attachmentCount:
      u._count.assignments +
      u._count.projectMembers +
      u._count.assignedTasks +
      u._count.createdTasks +
      u._count.comments +
      u._count.activityLogs,
  };
}

interface MergeUsersInput {
  fromId: string;
  toId: string;
  /** When set, the keeper's email is renamed AFTER the FK walk so the
   *  merged row holds the canonical address. */
  targetEmail?: string | null;
  /** When false, actually mutate. Defaults to true (preview only). */
  dryRun?: boolean;
}

export async function mergeUsers(
  input: MergeUsersInput
): Promise<MergeUsersResult> {
  const admin = await requireAuth();
  if (admin.role !== "ADMIN") {
    return { ok: false, error: "Admin access required" };
  }

  const fromId = input.fromId.trim();
  const toId = input.toId.trim();
  const targetEmail = (input.targetEmail ?? "").trim() || null;
  const dryRun = input.dryRun ?? true;

  if (!fromId || !toId) {
    return { ok: false, error: "Both source and keeper users are required" };
  }
  if (fromId === toId) {
    return { ok: false, error: "Source and keeper must be different users" };
  }
  if (fromId === admin.id) {
    return {
      ok: false,
      error: "You can't merge yourself away — log in as a different admin first",
    };
  }

  const [from, to] = await Promise.all([
    loadPreviewItem(fromId),
    loadPreviewItem(toId),
  ]);
  if (!from) return { ok: false, error: "Source user not found" };
  if (!to) return { ok: false, error: "Keeper user not found" };

  // Sanity guard: refuse if the source has materially MORE attachments
  // than the keeper. Almost always a sign the operator picked them in
  // the wrong direction. Override by swapping ids manually.
  if (from.attachmentCount > to.attachmentCount * 2 + 5) {
    return {
      ok: false,
      error:
        `Refusing to merge: source has ${from.attachmentCount} attachments vs keeper's ${to.attachmentCount}. ` +
        "Swap source ↔ keeper, or run the npm script directly if this really is intended.",
    };
  }

  const preview = {
    from,
    to,
    columnsToReassign: REASSIGNMENTS.length,
    targetEmail,
  };

  if (dryRun) {
    return { ok: true, preview };
  }

  // Live commit. Errors bubble as plain `error` so the UI can render
  // them inline instead of crashing.
  try {
    await executeMerge(db, fromId, toId, {
      targetEmail: targetEmail ?? undefined,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Merge failed (see server logs)";
    return { ok: false, error: message };
  }

  await logActivity(
    "merged",
    "user",
    toId,
    admin.id,
    `Merged ${from.name} <${from.email}> into ${to.name}` +
      (targetEmail ? `; renamed keeper to ${targetEmail}` : ""),
    {}
  );

  // The keeper inherits the source's role/title/department implicitly
  // through the FK walk — refresh every page that shows a User row.
  revalidateUser(toId);
  revalidatePath("/admin/users");

  return { ok: true, preview, committed: true };
}
