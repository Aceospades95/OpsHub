/**
 * Pure (db-free) half of the unified-contacts lib: the closed entity-
 * type set, labels, and href helpers. Split out of src/lib/contacts.ts
 * so CLIENT components (pickers, link dialogs) can import the
 * constants without dragging the Prisma client into the browser
 * bundle — same rule as lib/fleet.ts and the other client-safe libs.
 *
 * Server code should keep importing from "@/lib/contacts", which
 * re-exports everything here alongside the query helpers.
 */

/** The closed set of entity types a contact can be linked to. */
export const CONTACT_ENTITY_TYPES = [
  "client",
  "supplier",
  "subcontractor",
  "partnership",
  "bid",
  "project",
  "contract",
] as const;

export type ContactEntityType = (typeof CONTACT_ENTITY_TYPES)[number];

/** Singular display labels ("Client", "Bid", …). */
export const CONTACT_ENTITY_TYPE_LABELS: Record<ContactEntityType, string> = {
  client: "Client",
  supplier: "Supplier",
  subcontractor: "Subcontractor",
  partnership: "Partnership",
  bid: "Bid",
  project: "Project",
  contract: "Contract",
};

/** List-page base path per entity type ("/clients", "/bids", …). */
export const CONTACT_ENTITY_BASE_PATHS: Record<ContactEntityType, string> = {
  client: "/clients",
  supplier: "/suppliers",
  subcontractor: "/subcontractors",
  partnership: "/partnerships",
  bid: "/bids",
  project: "/projects",
  contract: "/contracts",
};

export function isContactEntityType(value: string): value is ContactEntityType {
  return (CONTACT_ENTITY_TYPES as readonly string[]).includes(value);
}

/**
 * Standard vocabulary for ContactLink.roles — offered as quick-add
 * toggle chips in the link UIs. Roles are free strings (people add
 * their own tags too); this list is just the shared starting point so
 * big accounts converge on the same spellings. Multiple tags per link
 * is the norm — one person can be both "Billing/AP" and "Scheduling".
 */
export const CONTACT_ROLE_SUGGESTIONS = [
  "Executive Sponsor",
  "Procurement",
  "Technical",
  "Billing/AP",
  "Field Ops",
  "Scheduling",
  "Legal",
  "PM",
] as const;

/** Per-link role-tag limits enforced by the actions and the tag input. */
export const MAX_ROLE_TAGS_PER_LINK = 10;
export const MAX_ROLE_TAG_LENGTH = 40;

/**
 * Canonical detail href for a link target. Clients and projects use
 * their slug when one exists (matching how their list pages build
 * hrefs — `/clients/${slug ?? id}`); every other type is id-only.
 */
export function contactEntityHref(
  entityType: ContactEntityType,
  target: { id: string; slug?: string | null }
): string {
  const base = CONTACT_ENTITY_BASE_PATHS[entityType];
  if (entityType === "client" || entityType === "project") {
    return `${base}/${target.slug ?? target.id}`;
  }
  return `${base}/${target.id}`;
}

/** Stable map key for a (entityType, entityId) pair. */
export function linkTargetKey(entityType: string, entityId: string): string {
  return `${entityType}:${entityId}`;
}
