"use server";

import { db } from "@/lib/db";
import { requireAuth } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { revalidatePath } from "next/cache";
import { revalidateProject } from "@/lib/revalidate-entity";
import {
  executeProjectMerge,
  normalizeProjectName,
  type ProjectMergeCounts,
} from "@/lib/merge-projects";

/**
 * Server actions backing the "Merge a duplicate into this project"
 * dialog on the project detail page.
 *
 * Same contract as actions/merge-users.ts: the action defaults to
 * dry-run preview and only the explicit Commit posts dryRun=false.
 * Unlike users (hard-delete), the merged-away project is soft-deleted,
 * so a mistaken merge is recoverable from /admin/recovery — though its
 * children stay with the keeper on restore.
 *
 * ADMIN-only: repointing every child row across a project boundary is
 * a data-surgery operation, not a routine edit.
 */

/** Relation-count keys shown in the preview, with human labels. */
const COUNT_LABELS: Record<string, string> = {
  contracts: "Contracts",
  documents: "Documents",
  files: "Files",
  comments: "Comments",
  members: "Members",
  milestones: "Milestones",
  links: "External links",
  embeds: "Embeds",
  tools: "Tools",
  tasks: "Tasks",
  sandboxPages: "Sandbox pages",
  sourceBids: "Bids",
  relations: "Related-project links",
  relatedRelations: "Referenced-by links",
  assignments: "Assignments",
  projectRoles: "Staffing roles",
  activityLogs: "Activity entries",
  quotes: "Quotes",
  suppliers: "Supplier links",
  subcontractors: "Subcontractor links",
  partnerships: "Partnership links",
  childProjects: "Sub-projects",
  contactLinks: "People",
};

export interface ProjectMergePreviewItem {
  id: string;
  name: string;
  status: string;
  clientId: string;
  clientName: string;
  createdAt: string;
  startDate: string | null;
  endDate: string | null;
  /** Sum across every child relation — the "how much moves" number. */
  attachmentCount: number;
  /** Non-zero relation counts, keyed by human label, for the preview table. */
  breakdown: Record<string, number>;
}

async function loadPreviewItem(
  id: string
): Promise<ProjectMergePreviewItem | null> {
  const p = await db.project.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      name: true,
      status: true,
      clientId: true,
      createdAt: true,
      startDate: true,
      endDate: true,
      client: { select: { name: true } },
      _count: {
        select: {
          contracts: true,
          documents: true,
          files: true,
          comments: true,
          members: true,
          milestones: true,
          links: true,
          embeds: true,
          tools: true,
          tasks: true,
          sandboxPages: true,
          sourceBids: true,
          relations: true,
          relatedRelations: true,
          assignments: true,
          projectRoles: true,
          activityLogs: true,
          quotes: true,
          suppliers: true,
          subcontractors: true,
          partnerships: true,
          childProjects: true,
        },
      },
    },
  });
  if (!p) return null;
  // Contact links are polymorphic (no Prisma relation on Project), so
  // they can't ride along in _count.
  const contactLinks = await db.contactLink.count({
    where: { entityType: "project", entityId: id },
  });

  const breakdown: Record<string, number> = {};
  let total = 0;
  for (const [key, count] of Object.entries(p._count)) {
    total += count;
    if (count > 0) breakdown[COUNT_LABELS[key] ?? key] = count;
  }
  if (contactLinks > 0) breakdown[COUNT_LABELS.contactLinks] = contactLinks;
  total += contactLinks;

  return {
    id: p.id,
    name: p.name,
    status: p.status,
    clientId: p.clientId,
    clientName: p.client.name,
    createdAt: p.createdAt.toISOString(),
    startDate: p.startDate?.toISOString() ?? null,
    endDate: p.endDate?.toISOString() ?? null,
    attachmentCount: total,
    breakdown,
  };
}

export interface MergeCandidate {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  /** True when the normalized name matches the keeper's — the twin the
   *  dialog exists for. Sorted first. */
  likelyDuplicate: boolean;
}

/**
 * Same-client sibling projects that could be merged into `projectId`.
 * Fetched lazily when the dialog opens — the page doesn't pay for it.
 */
export async function getMergeCandidates(
  projectId: string
): Promise<{ ok: true; candidates: MergeCandidate[] } | { ok: false; error: string }> {
  const admin = await requireAuth();
  if (admin.role !== "ADMIN") {
    return { ok: false, error: "Admin access required" };
  }
  const keeper = await db.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { id: true, name: true, clientId: true },
  });
  if (!keeper) return { ok: false, error: "Project not found" };

  const siblings = await db.project.findMany({
    where: { clientId: keeper.clientId, deletedAt: null, id: { not: keeper.id } },
    select: { id: true, name: true, status: true, createdAt: true },
    orderBy: { name: "asc" },
  });
  const keeperNorm = normalizeProjectName(keeper.name);
  const candidates = siblings
    .map((s) => ({
      id: s.id,
      name: s.name,
      status: s.status as string,
      createdAt: s.createdAt.toISOString(),
      likelyDuplicate: normalizeProjectName(s.name) === keeperNorm,
    }))
    .sort((a, b) =>
      a.likelyDuplicate === b.likelyDuplicate
        ? a.name.localeCompare(b.name)
        : a.likelyDuplicate
          ? -1
          : 1
    );
  return { ok: true, candidates };
}

export interface MergeProjectsResult {
  ok: boolean;
  error?: string;
  /** Filled on dry-run AND after a successful commit. */
  preview?: {
    from: ProjectMergePreviewItem;
    to: ProjectMergePreviewItem;
  };
  /** Per-model moved/dropped counts, filled after a live commit. */
  counts?: ProjectMergeCounts;
  committed?: boolean;
}

interface MergeProjectsInput {
  /** The duplicate being merged away (soft-deleted at the end). */
  fromId: string;
  /** The keeper — the project whose page the dialog was opened from. */
  toId: string;
  /** When false, actually mutate. Defaults to true (preview only). */
  dryRun?: boolean;
}

export async function mergeProjects(
  input: MergeProjectsInput
): Promise<MergeProjectsResult> {
  const admin = await requireAuth();
  if (admin.role !== "ADMIN") {
    return { ok: false, error: "Admin access required" };
  }

  const fromId = input.fromId.trim();
  const toId = input.toId.trim();
  const dryRun = input.dryRun ?? true;

  if (!fromId || !toId) {
    return { ok: false, error: "Both projects are required" };
  }
  if (fromId === toId) {
    return { ok: false, error: "Source and keeper must be different projects" };
  }

  const [from, to] = await Promise.all([
    loadPreviewItem(fromId),
    loadPreviewItem(toId),
  ]);
  if (!from) return { ok: false, error: "Source project not found (or already deleted)" };
  if (!to) return { ok: false, error: "Keeper project not found (or already deleted)" };

  // Cross-client merges are refused outright: the duplicates this tool
  // exists for are same-client twins, and silently moving contracts /
  // bids / tasks across a client boundary is almost certainly a mistake.
  if (from.clientId !== to.clientId) {
    return {
      ok: false,
      error: `Refusing to merge across clients: "${from.name}" belongs to ${from.clientName}, "${to.name}" to ${to.clientName}. Move the project to the right client first if this is intended.`,
    };
  }

  // Direction sanity guard (same formula as merge-users): if the
  // duplicate carries materially MORE children than the keeper, the
  // operator almost certainly has them backwards — merge should be run
  // from the fuller project's page instead.
  if (from.attachmentCount > to.attachmentCount * 2 + 5) {
    return {
      ok: false,
      error:
        `Refusing to merge: the duplicate has ${from.attachmentCount} attached records vs this project's ${to.attachmentCount}. ` +
        `Open "${from.name}" and merge "${to.name}" into it instead (or proceed from there if this really is intended).`,
    };
  }

  const preview = { from, to };
  if (dryRun) {
    return { ok: true, preview };
  }

  let counts: ProjectMergeCounts;
  try {
    counts = await executeProjectMerge(db, fromId, toId);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Merge failed (see server logs)";
    return { ok: false, error: message };
  }

  await logActivity(
    "merged",
    "project",
    toId,
    admin.id,
    `Merged duplicate "${from.name}" into "${to.name}" (${from.attachmentCount} attached record${from.attachmentCount === 1 ? "" : "s"} repointed)`,
    { projectId: toId, clientId: to.clientId }
  );

  revalidateProject(toId, { clientId: to.clientId });
  // The source was soft-deleted inside the transaction — skip its own
  // (now-hidden) detail path, same convention as deleteProject.
  revalidateProject(fromId, { clientId: from.clientId, deleted: true });
  revalidatePath("/projects");

  return { ok: true, preview, counts, committed: true };
}
