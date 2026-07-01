import type { Prisma, Role } from "@prisma/client";
import { hasOrgWideScope } from "@/lib/scope";

/**
 * Quote visibility rules (July 2026 access rework).
 *
 * Quotes are financial documents, so unlike projects/clients they are NOT
 * assignment-scoped — they're role-scoped:
 *
 *   ADMIN / DEVELOPER / MANAGER → every quote
 *   everyone else               → only quotes they created or are assigned to
 *
 * Field-tier accounts don't get quotes module access by default at all
 * (see FIELD_MODULE_DEFAULTS in lib/permissions.ts); these helpers are the
 * second layer for accounts that were explicitly granted the module —
 * a grant means "work with your own quotes", not "read the org's pricing".
 */
export function canSeeAllQuotes(role: Role): boolean {
  return hasOrgWideScope(role);
}

/** WHERE fragment limiting a quote query to the user's own quotes. */
export function ownQuotesWhere(userId: string): Prisma.QuoteWhereInput {
  return { OR: [{ createdById: userId }, { assignedToId: userId }] };
}

/** Per-row check for detail pages, export routes, and mutations. */
export function canAccessQuote(
  user: { id: string; role: Role },
  quote: { createdById: string; assignedToId: string | null }
): boolean {
  if (canSeeAllQuotes(user.role)) return true;
  return quote.createdById === user.id || quote.assignedToId === user.id;
}
