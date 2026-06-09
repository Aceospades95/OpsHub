"use server";

import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import {
  getUserScope,
  canViewEntity,
  hasOrgWideScope,
  type ScopeEntityType,
} from "@/lib/scope";
import { logActivity } from "@/lib/activity";
import { deriveActivityScope } from "@/lib/activity-scope";
import { notify } from "@/lib/notifications";
import {
  extractMentionedUserIds,
  stripMentionFormatting,
} from "@/lib/mentions";
import { absoluteUrl } from "@/lib/url";
import { revalidateComment } from "@/lib/revalidate-entity";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { rejectHtmlChars, HTML_CHARS_MESSAGE } from "@/lib/validation";

const entityModuleMap: Record<string, string> = {
  client: "clients",
  project: "projects",
  contract: "contracts",
  document: "projects",
  supplier: "suppliers",
  certification: "certifications",
  subcontractor: "subcontractors",
  partnership: "partnerships",
};

/**
 * Human-readable label for the entity a comment lives on, used in
 * mention notification copy ("Alice mentioned you on project Foo").
 */
const entityLabel: Record<string, string> = {
  client: "client",
  project: "project",
  contract: "contract",
  document: "document",
  supplier: "supplier",
  certification: "certification",
  subcontractor: "subcontractor",
  partnership: "partnership",
};

type CommentEntityType =
  | "client"
  | "project"
  | "contract"
  | "document"
  | "supplier"
  | "certification"
  | "subcontractor"
  | "partnership";

/**
 * Comment host types that participate in the per-entity visibility scope
 * (src/lib/scope.ts). Mentions on these hosts are filtered per recipient
 * so a mention can't leak the existence/name of an entity the recipient
 * can't view. The remaining host types (supplier, document, subcontractor,
 * partnership) aren't scoped — module-level perms are their only gate.
 */
const SCOPED_COMMENT_HOSTS: Partial<Record<CommentEntityType, ScopeEntityType>> = {
  client: "client",
  project: "project",
  contract: "contract",
  certification: "certification",
};

/**
 * Invalidate every page where the comment's host entity shows comments.
 * revalidateComment() covers most host types; supplier + certification
 * aren't in its union, so mirror its behavior (detail page + dashboard +
 * author profile) for those two.
 */
function revalidateCommentHost(
  entityType: CommentEntityType,
  entityId: string,
  authorId?: string | null
) {
  if (entityType === "supplier" || entityType === "certification") {
    revalidatePath(
      entityType === "supplier"
        ? `/suppliers/${entityId}`
        : `/certifications/${entityId}`
    );
    revalidatePath("/dashboard");
    if (authorId) revalidatePath(`/team/${authorId}`);
    return;
  }
  revalidateComment({ entityType, entityId, authorId });
}

const addCommentSchema = z.object({
  entityType: z.enum([
    "client",
    "project",
    "contract",
    "document",
    "supplier",
    "certification",
    "subcontractor",
    "partnership",
  ]),
  entityId: z.string().min(1),
  content: z
    .string()
    .min(1, "Comment cannot be empty")
    .max(10000, "Comment is too long")
    .refine(rejectHtmlChars, { message: HTML_CHARS_MESSAGE }),
});

/**
 * Look up an entity's display name and canonical URL for a notification
 * payload. Each entity type sits in a different table so we have to
 * switch. Returns null if the row doesn't exist (stale mention).
 */
async function resolveCommentEntity(
  entityType: CommentEntityType,
  entityId: string
): Promise<{ name: string; href: string } | null> {
  switch (entityType) {
    case "client": {
      const c = await db.client.findFirst({ where: { id: entityId, deletedAt: null }, select: { name: true } });
      return c ? { name: c.name, href: `/clients/${entityId}` } : null;
    }
    case "project": {
      const p = await db.project.findFirst({ where: { id: entityId, deletedAt: null }, select: { name: true } });
      return p ? { name: p.name, href: `/projects/${entityId}` } : null;
    }
    case "contract": {
      const c = await db.contract.findFirst({ where: { id: entityId, deletedAt: null }, select: { title: true } });
      return c ? { name: c.title, href: `/contracts/${entityId}` } : null;
    }
    case "document": {
      const d = await db.document.findFirst({
        where: { id: entityId, deletedAt: null },
        select: { title: true, projectId: true },
      });
      return d
        ? { name: d.title, href: `/projects/${d.projectId}/documents/${entityId}` }
        : null;
    }
    case "supplier": {
      const s = await db.supplier.findFirst({ where: { id: entityId, deletedAt: null }, select: { name: true } });
      return s ? { name: s.name, href: `/suppliers/${entityId}` } : null;
    }
    case "certification": {
      const c = await db.certification.findFirst({
        where: { id: entityId, deletedAt: null },
        select: { name: true },
      });
      return c ? { name: c.name, href: `/certifications/${entityId}` } : null;
    }
    case "subcontractor": {
      const s = await db.subcontractor.findFirst({
        where: { id: entityId, deletedAt: null },
        select: { name: true },
      });
      return s ? { name: s.name, href: `/subcontractors/${entityId}` } : null;
    }
    case "partnership": {
      const p = await db.partnership.findFirst({
        where: { id: entityId, deletedAt: null },
        select: { name: true },
      });
      return p ? { name: p.name, href: `/partnerships/${entityId}` } : null;
    }
  }
}

/**
 * Send @mention notifications for a comment. Best-effort — failures
 * are logged but never break the underlying comment create.
 */
async function notifyMentions(opts: {
  content: string;
  authorId: string;
  authorName: string;
  entityType: CommentEntityType;
  entityId: string;
  /** Pre-resolved host entity (addComment already looked it up). */
  entity?: { name: string; href: string } | null;
}) {
  const mentionedIds = extractMentionedUserIds(opts.content)
    // Don't notify the author when they mention themselves
    .filter((id) => id !== opts.authorId);

  if (mentionedIds.length === 0) return;

  try {
    // Drop ids that don't belong to active login users. Tracked-only
    // employees can't sign in to see an in-app notification, so a mention
    // on them is effectively a dead link.
    let activeRecipients = await db.user.findMany({
      where: { id: { in: mentionedIds }, isActive: true, hasLoginAccess: true },
      select: { id: true, name: true, role: true },
    });
    if (activeRecipients.length === 0) return;

    // For scoped host types, drop recipients who can't view the entity —
    // the notification title/body would otherwise leak its name to users
    // outside its visibility scope. Mentioned users are few, so a
    // per-recipient scope computation is acceptable; view-all roles skip
    // the query entirely.
    const scopedType = SCOPED_COMMENT_HOSTS[opts.entityType];
    if (scopedType) {
      const canView = await Promise.all(
        activeRecipients.map(async (u) => {
          if (hasOrgWideScope(u.role)) return true;
          const scope = await getUserScope(u.id, u.role);
          return canViewEntity(scope, scopedType, opts.entityId);
        })
      );
      activeRecipients = activeRecipients.filter((_, i) => canView[i]);
      if (activeRecipients.length === 0) return;
    }

    const entity =
      opts.entity ?? (await resolveCommentEntity(opts.entityType, opts.entityId));
    if (!entity) return;

    const label = entityLabel[opts.entityType] || opts.entityType;
    const heading = `${opts.authorName} mentioned you on ${label} ${entity.name}`;
    const plainBody = stripMentionFormatting(opts.content);
    const excerpt = plainBody.length > 240 ? `${plainBody.slice(0, 240)}…` : plainBody;

    // Broadcast: notify() will create one Notification row per recipient
    // and send one email each. We pick the first recipient's name for the
    // email template since it's just used as a salutation — the email
    // pipeline sends to each user's own address individually.
    await notify({
      recipientId: activeRecipients.map((u) => u.id),
      type: "mention",
      title: heading,
      body: excerpt,
      href: entity.href,
      actorId: opts.authorId,
      entityType: opts.entityType,
      entityId: opts.entityId,
      email: {
        templateKey: "notification",
        data: {
          recipientName: activeRecipients[0].name,
          heading,
          body: excerpt,
          cta: { label: `Open ${label}`, url: absoluteUrl(entity.href) },
        },
      },
    });
  } catch (err) {
    log.error("comments.notify", "Mention notify failed", err);
  }
}

export async function addComment(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const parsed = addCommentSchema.safeParse({
    entityType: formData.get("entityType"),
    entityId: formData.get("entityId"),
    content: formData.get("content"),
  });

  if (!parsed.success) {
    return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const { entityType, entityId, content } = parsed.data;
  const moduleName = entityModuleMap[entityType];
  const perms = await resolveModulePerms(user.id, user.role, moduleName);

  if (!perms.canComment) {
    return { error: "You don't have permission to comment" };
  }

  // Verify the host entity actually exists (and isn't soft-deleted)
  // before the dynamic `[entityType]Id` write — otherwise a forged
  // entityId would create an orphaned comment (or 500 on the FK).
  const hostEntity = await resolveCommentEntity(entityType, entityId);
  if (!hostEntity) return { error: "Not found" };

  const data: Record<string, unknown> = {
    content,
    authorId: user.id,
    [`${entityType}Id`]: entityId,
  };

  await db.comment.create({ data: data as never });
  // Activity log stores plain-text for human readability — strip the
  // raw `@[Name](id)` token syntax down to `@Name`
  const activityExcerpt = stripMentionFormatting(content).slice(0, 100);
  await logActivity("commented", entityType, entityId, user.id, activityExcerpt, await deriveActivityScope(entityType, entityId));

  await notifyMentions({
    content,
    authorId: user.id,
    authorName: user.name,
    entityType,
    entityId,
    entity: hostEntity,
  });

  revalidateCommentHost(entityType, entityId, user.id);
  return { success: true };
}

/**
 * Search for users who can be @mentioned. Used by the compose-time
 * autocomplete dropdown. Returns just the active, login-capable users
 * whose name or email starts with or contains the query. Any authenticated
 * user is allowed to call this — they can see names in the team directory
 * anyway, and restricting to `canView team` would break mentions for
 * people collaborating outside that module.
 */
export async function searchMentionableUsers(query: string) {
  const user = await requireAuth();
  // Mention autocomplete exposes the directory (names, emails, titles).
  // Restrict to users with `team` module access so a leaked GUEST
  // credential can't dump the whole employee list. Requires login
  // PLUS canView on team — which is implicitly true for almost every
  // role in src/lib/permissions.ts but explicitly false for GUESTs
  // not on team.
  const teamPerms = await resolveModulePerms(user.id, user.role, "team");
  if (!teamPerms.canView) {
    return { users: [] };
  }
  const q = query.trim();
  // Empty-query firehose removed: a stray "@" used to dump every
  // active user (id, name, email, title) — useful UX, but a phishing
  // dataset for any leaked credential. Require at least one
  // character. The mention plugin should suppress the dropdown until
  // the user types something anyway.
  if (q.length === 0) {
    return { users: [] };
  }
  // Only filter notification-eligible users (tracked-only employees
  // never get notified, so don't surface them in the dropdown — the
  // author would think they pinged someone who can't actually
  // receive the ping). hasLoginAccess: true matches notifyMentions.
  const users = await db.user.findMany({
    where: {
      isActive: true,
      hasLoginAccess: true,
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, email: true, jobTitle: true },
    orderBy: { name: "asc" },
    take: 8,
  });
  return { users };
}

export async function deleteComment(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const commentId = formData.get("commentId") as string;

  const comment = await db.comment.findUnique({ where: { id: commentId } });
  if (!comment) return { error: "Comment not found" };

  // Resolve the host entity from whichever FK is set — used for both the
  // permission check and the targeted revalidation below.
  const entityType: CommentEntityType = comment.clientId
    ? "client"
    : comment.projectId
      ? "project"
      : comment.contractId
        ? "contract"
        : comment.documentId
          ? "document"
          : comment.certificationId
            ? "certification"
            : comment.subcontractorId
              ? "subcontractor"
              : comment.partnershipId
                ? "partnership"
                : "supplier";
  const entityId =
    comment.clientId ??
    comment.projectId ??
    comment.contractId ??
    comment.documentId ??
    comment.certificationId ??
    comment.subcontractorId ??
    comment.partnershipId ??
    comment.supplierId;

  // Allow delete if user is author or has delete permission
  if (comment.authorId !== user.id) {
    const moduleName = entityModuleMap[entityType];
    const perms = await resolveModulePerms(user.id, user.role, moduleName);
    if (!perms.canDelete) {
      return { error: "You don't have permission to delete this comment" };
    }
  }

  await db.comment.delete({ where: { id: commentId } });
  if (entityId) {
    revalidateCommentHost(entityType, entityId, comment.authorId);
  } else {
    // Degenerate row with no host FK — fall back to the old broad sweep.
    revalidatePath("/");
  }
  return { success: true };
}
