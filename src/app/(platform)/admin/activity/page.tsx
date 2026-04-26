import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Download } from "lucide-react";
import Link from "next/link";

const PAGE_SIZE = 50;

interface SearchParams {
  actor?: string;
  entityType?: string;
  projectId?: string;
  clientId?: string;
  from?: string;
  to?: string;
  page?: string;
  [key: string]: string | undefined;
}

export default async function AdminActivityPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/dashboard");

  const where = buildWhere(searchParams);
  const page = Math.max(1, Number.parseInt(searchParams.page || "1", 10) || 1);

  const [rows, total, users, projects, clients, entityTypes] = await Promise.all([
    db.activityLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        user: { select: { id: true, name: true, email: true } },
        project: { select: { id: true, name: true } },
        client: { select: { id: true, name: true } },
      },
    }),
    db.activityLog.count({ where }),
    db.user.findMany({
      where: { activityLogs: { some: {} } },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
    db.project.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.client.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.activityLog.findMany({
      distinct: ["entityType"],
      select: { entityType: true },
      orderBy: { entityType: "asc" },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const csvHref = `/api/admin/activity/csv?${toQueryString(searchParams)}`;

  return (
    <div>
      <PageHeader
        title="Activity Log"
        description="Every create, update, and delete recorded across the platform"
        actions={
          <Link
            href={csvHref}
            className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted/30"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </Link>
        }
      />

      <Card className="mb-4">
        <CardContent className="p-4">
          <form
            method="get"
            action="/admin/activity"
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3 items-end"
          >
            <Field label="Actor">
              <select name="actor" defaultValue={searchParams.actor || ""} className={selectCls}>
                <option value="">Anyone</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Entity type">
              <select
                name="entityType"
                defaultValue={searchParams.entityType || ""}
                className={selectCls}
              >
                <option value="">Any</option>
                {entityTypes.map((e) => (
                  <option key={e.entityType} value={e.entityType}>
                    {e.entityType}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Project">
              <select
                name="projectId"
                defaultValue={searchParams.projectId || ""}
                className={selectCls}
              >
                <option value="">Any</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Client">
              <select
                name="clientId"
                defaultValue={searchParams.clientId || ""}
                className={selectCls}
              >
                <option value="">Any</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="From">
              <input
                type="date"
                name="from"
                defaultValue={searchParams.from || ""}
                className={selectCls}
              />
            </Field>
            <Field label="To">
              <input
                type="date"
                name="to"
                defaultValue={searchParams.to || ""}
                className={selectCls}
              />
            </Field>
            <div className="lg:col-span-6 flex items-center gap-2">
              <button
                type="submit"
                className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                Apply filters
              </button>
              <Link
                href="/admin/activity"
                className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted/30"
              >
                Clear
              </Link>
              <span className="ml-auto text-xs text-muted-foreground">
                {total.toLocaleString()} {total === 1 ? "entry" : "entries"}
              </span>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {rows.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No activity matches these filters.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">When</th>
                  <th className="text-left px-3 py-2 font-medium">Actor</th>
                  <th className="text-left px-3 py-2 font-medium">Action</th>
                  <th className="text-left px-3 py-2 font-medium">Entity</th>
                  <th className="text-left px-3 py-2 font-medium">Project</th>
                  <th className="text-left px-3 py-2 font-medium">Client</th>
                  <th className="text-left px-3 py-2 font-medium">Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-border">
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-muted-foreground">
                      {format(row.createdAt, "yyyy-MM-dd HH:mm")}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{row.user?.name || "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <Badge variant="outline" className="text-[10px] font-mono">
                        {row.action}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs">
                      <span className="font-mono text-muted-foreground">{row.entityType}</span>
                      <span className="text-muted-foreground/60"> · </span>
                      <span className="font-mono text-[11px]">{row.entityId.slice(0, 8)}</span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {row.project ? (
                        <Link href={`/projects/${row.project.id}`} className="hover:underline">
                          {row.project.name}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {row.client ? (
                        <Link href={`/clients/${row.client.id}`} className="hover:underline">
                          {row.client.name}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground max-w-md truncate">
                      {row.details || ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={`/admin/activity?${toQueryString({ ...searchParams, page: String(page - 1) })}`}
                className="rounded border border-border px-3 py-1 hover:bg-muted/30"
              >
                Previous
              </Link>
            )}
            {page < totalPages && (
              <Link
                href={`/admin/activity?${toQueryString({ ...searchParams, page: String(page + 1) })}`}
                className="rounded border border-border px-3 py-1 hover:bg-muted/30"
              >
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs text-muted-foreground mb-1">{label}</span>
      {children}
    </label>
  );
}

const selectCls =
  "w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary";

function buildWhere(params: SearchParams) {
  const where: Record<string, unknown> = {};
  if (params.actor) where.userId = params.actor;
  if (params.entityType) where.entityType = params.entityType;
  if (params.projectId) where.projectId = params.projectId;
  if (params.clientId) where.clientId = params.clientId;
  if (params.from || params.to) {
    const range: Record<string, Date> = {};
    if (params.from) range.gte = new Date(params.from);
    if (params.to) {
      // Treat the end date as inclusive (end of day in UTC)
      const end = new Date(params.to);
      end.setUTCHours(23, 59, 59, 999);
      range.lte = end;
    }
    where.createdAt = range;
  }
  return where;
}

function toQueryString(params: { [key: string]: string | undefined }): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) usp.set(k, v);
  }
  return usp.toString();
}
