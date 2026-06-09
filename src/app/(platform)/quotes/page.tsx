import { db } from "@/lib/db";
import Link from "next/link";
import { Suspense } from "react";
import { format } from "date-fns";
import { ReceiptText } from "lucide-react";

import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/quotes/totals";

import { QuoteCreateButton } from "./quote-create-button";
import { QuoteFilters } from "./quote-filters";
import { Prisma } from "@prisma/client";

type SortKey = "updated" | "created" | "client" | "project" | "number" | "total";

const VALID_SORTS: SortKey[] = [
  "updated",
  "created",
  "client",
  "project",
  "number",
  "total",
];

function isSort(s: string | undefined): s is SortKey {
  return !!s && (VALID_SORTS as string[]).includes(s);
}

function orderByForSort(sort: SortKey): Prisma.QuoteOrderByWithRelationInput {
  switch (sort) {
    case "client":
      return { client: { name: "asc" } };
    case "project":
      return { project: { name: "asc" } };
    case "number":
      return { quoteNumber: "asc" };
    case "total":
      return { total: "desc" };
    case "created":
      return { createdAt: "desc" };
    case "updated":
    default:
      return { updatedAt: "desc" };
  }
}

export const metadata = { title: "Quotes · OpsHub" };

export default async function QuotesPage({
  searchParams,
}: {
  searchParams: { clientId?: string; projectId?: string; sort?: string; q?: string };
}) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "quotes");
  if (!perms.canView) {
    return (
      <AccessDenied
        module="quotes"
        moduleLabel="Quotes"
        moduleDescription="Stored sales quotes and proposals"
      />
    );
  }

  const sort = isSort(searchParams.sort) ? searchParams.sort : "updated";
  const search = searchParams.q?.trim();
  const clientId = searchParams.clientId?.trim();
  const projectId = searchParams.projectId?.trim();

  const where: Prisma.QuoteWhereInput = { deletedAt: null };
  if (clientId) where.clientId = clientId;
  if (projectId) where.projectId = projectId;
  if (search) {
    where.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { quoteNumber: { contains: search, mode: "insensitive" } },
      { client: { name: { contains: search, mode: "insensitive" } } },
      { project: { name: { contains: search, mode: "insensitive" } } },
    ];
  }

  const [clients, quotes] = await Promise.all([
    db.client.findMany({
      where: { status: { in: ["ACTIVE", "PROSPECT"] }, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.quote.findMany({
      where,
      orderBy: orderByForSort(sort),
      include: {
        client: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
      },
      take: 500,
    }),
  ]);

  return (
    <div>
      <PageHeader
        title="Quotes"
        description="Build and store sales quotes — sort, search, and download as PDF or Word."
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/quotes/templates"
              className="text-sm text-muted-foreground hover:text-foreground hover:underline"
            >
              Templates
            </Link>
            <Link
              href="/quotes/catalog"
              className="text-sm text-muted-foreground hover:text-foreground hover:underline"
            >
              Catalog
            </Link>
            {perms.canCreate && <QuoteCreateButton clients={clients} />}
          </div>
        }
      />

      <Suspense fallback={null}>
        <QuoteFilters
          clients={clients}
          currentClientId={clientId}
          currentSort={sort}
          currentSearch={search}
          resultCount={quotes.length}
        />
      </Suspense>

      {quotes.length === 0 ? (
        <EmptyState
          icon={ReceiptText}
          title="No quotes yet"
          description={
            clientId || projectId || search
              ? "No quotes match the current filter"
              : "Create your first quote to get started"
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Number</th>
                    <th className="px-4 py-3 text-left font-medium">Title</th>
                    <th className="px-4 py-3 text-left font-medium">Client</th>
                    <th className="px-4 py-3 text-left font-medium">Project</th>
                    <th className="px-4 py-3 text-right font-medium">Total</th>
                    <th className="px-4 py-3 text-left font-medium">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {quotes.map((q) => (
                    <tr
                      key={q.id}
                      className="border-t border-border hover:bg-muted/40 transition-colors"
                    >
                      <td className="px-4 py-3 font-mono text-xs">
                        <Link href={`/quotes/${q.id}`} className="hover:underline">
                          {q.quoteNumber}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/quotes/${q.id}`}
                            className="font-medium hover:text-primary hover:underline"
                          >
                            {/* Legacy quotes saved before the auto-derived
                             *  title shipped show "Untitled Quote" verbatim;
                             *  fall back to a scannable client+number label
                             *  so the list isn't a column of identical cells. */}
                            {q.title === "Untitled Quote" || !q.title.trim()
                              ? `${q.client.name} — ${q.quoteNumber}`
                              : q.title}
                          </Link>
                          {/* Flag abandoned drafts: created-but-never-finished
                           *  rows that have no project and a $0 total. Helps
                           *  the owner spot rows worth deleting. */}
                          {q.status === "DRAFT" && q.total === 0 && !q.projectId && (
                            <Badge variant="outline" className="text-[10px]">
                              Empty draft
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/clients/${q.client.id}`}
                          className="text-muted-foreground hover:text-primary hover:underline"
                        >
                          {q.client.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {q.project ? (
                          <Link
                            href={`/projects/${q.project.id}`}
                            className="hover:text-primary hover:underline"
                          >
                            {q.project.name}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatCurrency(q.total, q.currency)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {format(q.updatedAt, "MMM d, yyyy")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
