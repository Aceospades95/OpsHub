"use server";

import { db } from "@/lib/db";
import { vehicleLabel } from "@/lib/fleet";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { getUserScope, hasOrgWideManage } from "@/lib/scope";

/**
 * Cross-entity quick-find search powering the Cmd-K command palette.
 *
 * Caps each entity bucket at 5 hits so the palette stays scannable even
 * for vague queries; the user can drill into a list view if they need
 * more.
 *
 * Authorization:
 *  - Module-level canView gate: each bucket is included only if the
 *    caller has canView for the bucket's module. A user with no
 *    suppliers permission (e.g. GUEST) never sees a suppliers
 *    section, even with truncated:false.
 *  - Entity-scope filter: for entity-scoped modules (clients,
 *    projects, contracts, quotes), the SQL where-clause also
 *    restricts results to the IDs in the caller's getUserScope()
 *    set. The DB does the filtering so timing doesn't leak the
 *    count of restricted rows.
 *  - Empty / whitespace queries return no results (the palette
 *    renders a "type to search…" hint instead of a flood of recents).
 */

export interface SearchHit {
  /** Stable id used for keyboard navigation. */
  id: string;
  /** Bucket — drives the section label and the lucide icon. */
  type:
    | "employee"
    | "client"
    | "contact"
    | "project"
    | "supplier"
    | "contract"
    | "quote"
    | "tool"
    | "vehicle"
    | "bid"
    | "intranet";
  label: string;
  sublabel?: string;
  href: string;
}

export interface SearchResults {
  hits: SearchHit[];
  /** True when at least one bucket was capped at the per-bucket limit. */
  truncated: boolean;
}

const PER_BUCKET_LIMIT = 5;

export async function quickSearch(query: string): Promise<SearchResults> {
  const trimmed = query.trim();
  if (trimmed.length < 1) return { hits: [], truncated: false };

  const user = await requireAuth();
  const scope = await getUserScope(user.id, user.role);
  const orgWide = hasOrgWideManage(user.role) || scope.all;

  // Module-level canView for each bucket. A user without canView for
  // suppliers must not see a suppliers section in the palette,
  // regardless of scope. Resolve in parallel — these are cached per
  // request anyway so the cost is one cheap DB roundtrip.
  const [
    teamPerms,
    clientsPerms,
    projectsPerms,
    suppliersPerms,
    contractsPerms,
    quotesPerms,
    toolsPerms,
    intranetPerms,
    fleetPerms,
    bidsPerms,
  ] = await Promise.all([
    resolveModulePerms(user.id, user.role, "team"),
    resolveModulePerms(user.id, user.role, "clients"),
    resolveModulePerms(user.id, user.role, "projects"),
    resolveModulePerms(user.id, user.role, "suppliers"),
    resolveModulePerms(user.id, user.role, "contracts"),
    resolveModulePerms(user.id, user.role, "quotes"),
    resolveModulePerms(user.id, user.role, "tools"),
    resolveModulePerms(user.id, user.role, "intranet"),
    resolveModulePerms(user.id, user.role, "fleet"),
    resolveModulePerms(user.id, user.role, "bids"),
  ]);

  // Build scope-aware filters. Each entity type is limited to the rows
  // the viewer can see — same gate the list pages use.
  const projectScope = orgWide
    ? {}
    : { id: { in: Array.from(scope.projectIds) } };
  const clientScope = orgWide
    ? {}
    : { id: { in: Array.from(scope.clientIds) } };
  const toolScope = orgWide
    ? {}
    : { id: { in: Array.from(scope.toolIds) } };
  const vehicleScope = orgWide
    ? {}
    : { id: { in: Array.from(scope.vehicleIds) } };

  const ci = { contains: trimmed, mode: "insensitive" as const };

  const [
    employees,
    clients,
    contacts,
    projects,
    suppliers,
    contracts,
    quotes,
    tools,
    intranet,
    vehicles,
    bids,
  ] = await Promise.all([
    teamPerms.canView
      ? db.user.findMany({
          where: {
            isActive: true,
            OR: [{ name: ci }, { email: ci }, { jobTitle: ci }],
          },
          select: { id: true, name: true, jobTitle: true, department: true, email: true },
          take: PER_BUCKET_LIMIT,
          orderBy: { name: "asc" },
        })
      : [],
    clientsPerms.canView
      ? db.client.findMany({
          where: {
            deletedAt: null,
            AND: [
              clientScope,
              { OR: [{ name: ci }, { industry: ci }] },
            ],
          },
          select: { id: true, name: true, industry: true },
          take: PER_BUCKET_LIMIT,
          orderBy: { name: "asc" },
        })
      : [],
    // Unified contacts ride on the clients-module gate — same gate the
    // /contacts pages use (contacts span modules; see actions/contacts).
    clientsPerms.canView
      ? db.contact.findMany({
          where: {
            deletedAt: null,
            OR: [{ name: ci }, { email: ci }, { organization: ci }],
          },
          select: { id: true, name: true, title: true, organization: true, email: true },
          take: PER_BUCKET_LIMIT,
          orderBy: [{ isFormer: "asc" }, { name: "asc" }],
        })
      : [],
    projectsPerms.canView
      ? db.project.findMany({
          where: {
            deletedAt: null,
            AND: [
              projectScope,
              { OR: [{ name: ci }, { description: ci }] },
            ],
          },
          select: {
            id: true,
            name: true,
            client: { select: { name: true } },
          },
          take: PER_BUCKET_LIMIT,
          orderBy: { updatedAt: "desc" },
        })
      : [],
    suppliersPerms.canView
      ? db.supplier.findMany({
          where: {
            deletedAt: null,
            // Person-name matches are served by the contacts bucket —
            // the frozen SupplierContact table would only ever match
            // pre-migration names and drift as the rolodex is edited.
            OR: [{ name: ci }, { contactName: ci }, { category: ci }],
          },
          select: { id: true, name: true, category: true },
          take: PER_BUCKET_LIMIT,
          orderBy: { name: "asc" },
        })
      : [],
    contractsPerms.canView
      ? db.contract.findMany({
          where: {
            deletedAt: null,
            AND: [
              orgWide
                ? {}
                : {
                    OR: [
                      { clientId: { in: Array.from(scope.clientIds) } },
                      { projectId: { in: Array.from(scope.projectIds) } },
                    ],
                  },
              { OR: [{ title: ci }, { contractNumber: ci }] },
            ],
          },
          select: {
            id: true,
            title: true,
            contractNumber: true,
            client: { select: { name: true } },
          },
          take: PER_BUCKET_LIMIT,
          orderBy: { updatedAt: "desc" },
        })
      : [],
    quotesPerms.canView
      ? db.quote.findMany({
          where: {
            deletedAt: null,
            AND: [
              orgWide
                ? {}
                : {
                    OR: [
                      { clientId: { in: Array.from(scope.clientIds) } },
                      { projectId: { in: Array.from(scope.projectIds) } },
                    ],
                  },
              { OR: [{ title: ci }, { quoteNumber: ci }] },
            ],
          },
          select: {
            id: true,
            title: true,
            quoteNumber: true,
            client: { select: { name: true } },
          },
          take: PER_BUCKET_LIMIT,
          orderBy: { updatedAt: "desc" },
        })
      : [],
    toolsPerms.canView
      ? db.tool.findMany({
          where: {
            deletedAt: null,
            AND: [
              toolScope,
              { OR: [{ name: ci }, { description: ci }, { category: ci }] },
            ],
          },
          select: { id: true, name: true, category: true },
          take: PER_BUCKET_LIMIT,
          orderBy: { name: "asc" },
        })
      : [],
    intranetPerms.canView
      ? db.intranetResource.findMany({
          where: {
            deletedAt: null,
            published: true,
            OR: [{ title: ci }, { description: ci }],
          },
          select: { id: true, title: true, category: true },
          take: PER_BUCKET_LIMIT,
          orderBy: { updatedAt: "desc" },
        })
      : [],
    fleetPerms.canView
      ? db.vehicle.findMany({
          where: {
            deletedAt: null,
            AND: [
              vehicleScope,
              {
                OR: [
                  { nickname: ci },
                  { make: ci },
                  { model: ci },
                  { vin: ci },
                  { licensePlate: ci },
                ],
              },
            ],
          },
          select: {
            id: true,
            nickname: true,
            year: true,
            make: true,
            model: true,
            licensePlate: true,
          },
          take: PER_BUCKET_LIMIT,
          orderBy: [{ make: "asc" }, { model: "asc" }],
        })
      : [],
    bidsPerms.canView
      ? db.bidOpportunity.findMany({
          where: {
            deletedAt: null,
            OR: [{ title: ci }, { solicitationNumber: ci }, { agency: ci }],
          },
          select: { id: true, title: true, agency: true, solicitationNumber: true },
          take: PER_BUCKET_LIMIT,
          orderBy: { updatedAt: "desc" },
        })
      : [],
  ]);

  const hits: SearchHit[] = [
    ...employees.map((e) => ({
      id: `employee-${e.id}`,
      type: "employee" as const,
      label: e.name,
      sublabel: e.jobTitle || e.department || e.email,
      href: `/team/${e.id}`,
    })),
    ...clients.map((c) => ({
      id: `client-${c.id}`,
      type: "client" as const,
      label: c.name,
      sublabel: c.industry || undefined,
      href: `/clients/${c.id}`,
    })),
    ...contacts.map((c) => ({
      id: `contact-${c.id}`,
      type: "contact" as const,
      label: c.name,
      sublabel:
        [c.title, c.organization].filter(Boolean).join(" · ") || c.email || undefined,
      href: `/contacts/${c.id}`,
    })),
    ...projects.map((p) => ({
      id: `project-${p.id}`,
      type: "project" as const,
      label: p.name,
      sublabel: p.client?.name,
      href: `/projects/${p.id}`,
    })),
    ...suppliers.map((s) => ({
      id: `supplier-${s.id}`,
      type: "supplier" as const,
      label: s.name,
      sublabel: s.category,
      href: `/suppliers/${s.id}`,
    })),
    ...contracts.map((c) => ({
      id: `contract-${c.id}`,
      type: "contract" as const,
      label: c.title,
      sublabel: [c.contractNumber, c.client?.name].filter(Boolean).join(" · ") || undefined,
      href: `/contracts/${c.id}`,
    })),
    ...quotes.map((q) => ({
      id: `quote-${q.id}`,
      type: "quote" as const,
      label: q.title,
      sublabel: [q.quoteNumber, q.client?.name].filter(Boolean).join(" · ") || undefined,
      href: `/quotes/${q.id}`,
    })),
    ...tools.map((t) => ({
      id: `tool-${t.id}`,
      type: "tool" as const,
      label: t.name,
      sublabel: t.category || undefined,
      href: `/tools/${t.id}`,
    })),
    ...intranet.map((r) => ({
      id: `intranet-${r.id}`,
      type: "intranet" as const,
      label: r.title,
      sublabel: r.category,
      href: `/intranet/${r.id}`,
    })),
    ...vehicles.map((v) => ({
      id: `vehicle-${v.id}`,
      type: "vehicle" as const,
      label: vehicleLabel(v),
      sublabel: v.licensePlate || undefined,
      href: `/fleet/${v.id}`,
    })),
    ...bids.map((b) => ({
      id: `bid-${b.id}`,
      type: "bid" as const,
      label: b.title,
      sublabel: [b.agency, b.solicitationNumber].filter(Boolean).join(" · ") || undefined,
      href: `/bids/${b.id}`,
    })),
  ];

  const truncated =
    employees.length === PER_BUCKET_LIMIT ||
    clients.length === PER_BUCKET_LIMIT ||
    contacts.length === PER_BUCKET_LIMIT ||
    projects.length === PER_BUCKET_LIMIT ||
    suppliers.length === PER_BUCKET_LIMIT ||
    contracts.length === PER_BUCKET_LIMIT ||
    quotes.length === PER_BUCKET_LIMIT ||
    tools.length === PER_BUCKET_LIMIT ||
    intranet.length === PER_BUCKET_LIMIT ||
    vehicles.length === PER_BUCKET_LIMIT ||
    bids.length === PER_BUCKET_LIMIT;

  return { hits, truncated };
}
