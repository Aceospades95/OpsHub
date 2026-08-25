/**
 * Unified contacts — helpers for the Contact / ContactLink backend.
 *
 * A Contact is a PERSON, independent of any one organization. It
 * connects to clients / suppliers / subcontractors / partnerships /
 * bids / projects / contracts through polymorphic ContactLink rows
 * (entityType + entityId, no FK). Targets are soft-deleted records,
 * so everything here resolves names at read time and silently skips
 * dangling or soft-deleted targets rather than 500ing.
 *
 * This module touches the db, so it is SERVER-ONLY. The pure parts
 * (entity-type set, labels, href builders) live in
 * src/lib/contact-types.ts and are re-exported here — client
 * components import them from "@/lib/contact-types" directly.
 * Mutations live in src/actions/contacts.ts.
 */

import { db } from "@/lib/db";
import {
  contactEntityHref,
  isContactEntityType,
  linkTargetKey,
  type ContactEntityType,
} from "@/lib/contact-types";

export {
  CONTACT_ENTITY_TYPES,
  CONTACT_ENTITY_TYPE_LABELS,
  CONTACT_ENTITY_BASE_PATHS,
  CONTACT_ROLE_SUGGESTIONS,
  MAX_ROLE_TAGS_PER_LINK,
  MAX_ROLE_TAG_LENGTH,
  contactEntityHref,
  isContactEntityType,
  linkTargetKey,
} from "@/lib/contact-types";
export type { ContactEntityType } from "@/lib/contact-types";

/**
 * Active links (contact not soft-deleted) for one entity, with the
 * contact included. Former people sort last, the primary contact
 * first, then alphabetically — the order every mount site renders.
 */
export async function getContactsFor(entityType: ContactEntityType, entityId: string) {
  return db.contactLink.findMany({
    where: {
      entityType,
      entityId,
      contact: { deletedAt: null },
    },
    include: { contact: true },
    orderBy: [
      { contact: { isFormer: "asc" } },
      { isPrimary: "desc" },
      { contact: { name: "asc" } },
    ],
  });
}

export interface ResolvedLinkTarget {
  name: string;
  href: string;
}

/**
 * Batch-resolve link targets to display names + hrefs.
 *
 * One query per entity type present in `links` (not per link). The
 * returned map is keyed by `linkTargetKey(entityType, entityId)`;
 * links whose target is missing or soft-deleted simply have no map
 * entry — callers skip them silently (the ContactLink table has no
 * FK to targets, so dangling rows are expected).
 */
export async function resolveLinkTargets(
  links: { entityType: string; entityId: string }[]
): Promise<Map<string, ResolvedLinkTarget>> {
  const idsByType = new Map<ContactEntityType, Set<string>>();
  for (const link of links) {
    if (!isContactEntityType(link.entityType)) continue;
    const set = idsByType.get(link.entityType) ?? new Set<string>();
    set.add(link.entityId);
    idsByType.set(link.entityType, set);
  }

  const resolved = new Map<string, ResolvedLinkTarget>();
  const put = (
    type: ContactEntityType,
    rows: { id: string; name: string; slug?: string | null }[]
  ) => {
    for (const row of rows) {
      resolved.set(linkTargetKey(type, row.id), {
        name: row.name,
        href: contactEntityHref(type, row),
      });
    }
  };

  await Promise.all(
    Array.from(idsByType.entries()).map(async ([type, idSet]) => {
      const ids = Array.from(idSet);
      const notDeleted = { id: { in: ids }, deletedAt: null };
      switch (type) {
        case "client": {
          const rows = await db.client.findMany({
            where: notDeleted,
            select: { id: true, name: true, slug: true },
          });
          put(type, rows);
          break;
        }
        case "supplier": {
          const rows = await db.supplier.findMany({
            where: notDeleted,
            select: { id: true, name: true },
          });
          put(type, rows);
          break;
        }
        case "subcontractor": {
          const rows = await db.subcontractor.findMany({
            where: notDeleted,
            select: { id: true, name: true },
          });
          put(type, rows);
          break;
        }
        case "partnership": {
          const rows = await db.partnership.findMany({
            where: notDeleted,
            select: { id: true, name: true },
          });
          put(type, rows);
          break;
        }
        case "bid": {
          const rows = await db.bidOpportunity.findMany({
            where: notDeleted,
            select: { id: true, title: true },
          });
          put(type, rows.map((r) => ({ id: r.id, name: r.title })));
          break;
        }
        case "project": {
          const rows = await db.project.findMany({
            where: notDeleted,
            select: { id: true, name: true, slug: true },
          });
          put(type, rows);
          break;
        }
        case "contract": {
          const rows = await db.contract.findMany({
            where: notDeleted,
            select: { id: true, title: true },
          });
          put(type, rows.map((r) => ({ id: r.id, name: r.title })));
          break;
        }
      }
    })
  );

  return resolved;
}
