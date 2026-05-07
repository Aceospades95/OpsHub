"use server";

import { db } from "@/lib/db";
import { requireAuth } from "@/lib/permissions";
import { getUserScope, hasOrgWideManage } from "@/lib/scope";

/**
 * Cross-entity quick-find search powering the Cmd-K command palette.
 *
 * Caps each entity bucket at 5 hits so the palette stays scannable even
 * for vague queries; the user can drill into a list view if they need
 * more. Scope is honored — non-org-wide users only see entities they
 * have access to via getUserScope().
 *
 * Empty / whitespace queries return no results (the palette renders a
 * "type to search…" hint in that state instead of a flood of recents).
 */

export interface SearchHit {
  /** Stable id used for keyboard navigation. */
  id: string;
  /** Bucket — drives the section label and the lucide icon. */
  type:
    | "employee"
    | "client"
    | "project"
    | "supplier"
    | "contract"
    | "quote"
    | "tool"
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

  // Build scope-aware filters. Each entity type is limited to the rows
  // the viewer can see — same gate the list pages use.
  const projectScope = orgWide
    ? {}
    : { id: { in: Array.from(scope.projectIds) } };
  const clientScope = orgWide
    ? {}
    : { id: { in: Array.from(scope.clientIds) } };

  const ci = { contains: trimmed, mode: "insensitive" as const };

  const [
    employees,
    clients,
    projects,
    suppliers,
    contracts,
    quotes,
    tools,
    intranet,
  ] = await Promise.all([
    db.user.findMany({
      where: {
        isActive: true,
        OR: [{ name: ci }, { email: ci }, { jobTitle: ci }],
      },
      select: { id: true, name: true, jobTitle: true, department: true, email: true },
      take: PER_BUCKET_LIMIT,
      orderBy: { name: "asc" },
    }),
    db.client.findMany({
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
    }),
    db.project.findMany({
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
    }),
    db.supplier.findMany({
      where: {
        deletedAt: null,
        OR: [{ name: ci }, { contactName: ci }, { category: ci }],
      },
      select: { id: true, name: true, category: true },
      take: PER_BUCKET_LIMIT,
      orderBy: { name: "asc" },
    }),
    db.contract.findMany({
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
    }),
    db.quote.findMany({
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
    }),
    db.tool.findMany({
      where: {
        deletedAt: null,
        OR: [{ name: ci }, { description: ci }, { category: ci }],
      },
      select: { id: true, name: true, category: true },
      take: PER_BUCKET_LIMIT,
      orderBy: { name: "asc" },
    }),
    db.intranetResource.findMany({
      where: {
        deletedAt: null,
        published: true,
        OR: [{ title: ci }, { description: ci }],
      },
      select: { id: true, title: true, category: true },
      take: PER_BUCKET_LIMIT,
      orderBy: { updatedAt: "desc" },
    }),
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
  ];

  const truncated =
    employees.length === PER_BUCKET_LIMIT ||
    clients.length === PER_BUCKET_LIMIT ||
    projects.length === PER_BUCKET_LIMIT ||
    suppliers.length === PER_BUCKET_LIMIT ||
    contracts.length === PER_BUCKET_LIMIT ||
    quotes.length === PER_BUCKET_LIMIT ||
    tools.length === PER_BUCKET_LIMIT ||
    intranet.length === PER_BUCKET_LIMIT;

  return { hits, truncated };
}
