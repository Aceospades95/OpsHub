import { db } from "@/lib/db";
import { requireAuth } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Database, Users, GitMerge, HardDrive } from "lucide-react";

export const metadata = { title: "Usage Census · OpsHub" };
export const dynamic = "force-dynamic";

/**
 * One-stop usage census — the data needed to make the three deferred
 * structural decisions with facts instead of memory:
 *
 *   1. P5 scope trim: which of the big optional subsystems (workflows,
 *      sandbox pages, widget builder, custom reports, importers, access
 *      requests) actually hold data → what can be deleted outright.
 *   2. Role enum collapse: are there any users still on the legacy
 *      DEVELOPER / VIEWER / GUEST roles?
 *   3. ProjectMember ↔ Assignment merge: how much do the two membership
 *      systems overlap / disagree?
 *
 * Read-only; every number is a live count. ADMIN only.
 */

interface CensusRow {
  label: string;
  count: number;
  lastActivity: Date | null;
  note?: string;
}

async function countWithLatest(
  count: Promise<number>,
  latest: Promise<{ updatedAt?: Date | null; createdAt?: Date | null } | null>
): Promise<{ count: number; lastActivity: Date | null }> {
  const [c, row] = await Promise.all([count, latest]);
  return { count: c, lastActivity: row?.updatedAt ?? row?.createdAt ?? null };
}

export default async function CensusPage() {
  const user = await requireAuth();
  if (user.role !== "ADMIN") redirect("/dashboard");

  // ── P5 candidates: the "is anyone actually using this?" list ──
  const [
    workflowTemplates,
    workflowInstances,
    sandboxPages,
    customWidgets,
    customReports,
    importRuns,
    accessRequests,
    scheduledTasks,
    quoteCount,
    portalTokens,
  ] = await Promise.all([
    countWithLatest(
      db.workflowTemplate.count({ where: { isSeed: false } }),
      db.workflowTemplate.findFirst({ where: { isSeed: false }, orderBy: { updatedAt: "desc" }, select: { updatedAt: true } })
    ),
    countWithLatest(
      db.workflowInstance.count(),
      db.workflowInstance.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } })
    ),
    countWithLatest(
      db.sandboxPage.count(),
      db.sandboxPage.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true } })
    ),
    countWithLatest(
      db.customWidget.count(),
      db.customWidget.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true } })
    ),
    countWithLatest(
      db.customReport.count(),
      db.customReport.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true } })
    ),
    countWithLatest(
      db.importLog.count(),
      db.importLog.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } })
    ),
    countWithLatest(
      db.accessRequest.count(),
      db.accessRequest.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } })
    ),
    countWithLatest(
      db.scheduledTask.count(),
      db.scheduledTask.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true } })
    ),
    countWithLatest(
      db.quote.count({ where: { deletedAt: null } }),
      db.quote.findFirst({ where: { deletedAt: null }, orderBy: { updatedAt: "desc" }, select: { updatedAt: true } })
    ),
    countWithLatest(
      db.portalToken.count(),
      db.portalToken.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } })
    ),
  ]);

  const p5Rows: CensusRow[] = [
    { label: "Workflow templates (non-seed)", ...workflowTemplates, note: "Workflow engine + portal + analytics — the single biggest deletion candidate" },
    { label: "Workflow instances (runs)", ...workflowInstances },
    { label: "Portal tokens (workflow portal)", ...portalTokens },
    { label: "Sandbox pages (page builder)", ...sandboxPages },
    { label: "Custom widgets (widget builder)", ...customWidgets },
    { label: "Custom reports (report builder)", ...customReports },
    { label: "CSV import runs (20 importers)", ...importRuns },
    { label: "Access requests", ...accessRequests },
    { label: "Custom scheduled tasks", ...scheduledTasks },
    { label: "Quotes (for reference — keeper)", ...quoteCount },
  ];

  // ── Core modules, for contrast ──
  const [clients, projects, tasks, contracts, certs, suppliers, subs, partners, tools, vehicles, bids, intranet] =
    await Promise.all([
      db.client.count({ where: { deletedAt: null } }),
      db.project.count({ where: { deletedAt: null } }),
      db.task.count({ where: { deletedAt: null } }),
      db.contract.count({ where: { deletedAt: null } }),
      db.certification.count({ where: { deletedAt: null } }),
      db.supplier.count({ where: { deletedAt: null } }),
      db.subcontractor.count({ where: { deletedAt: null } }),
      db.partnership.count({ where: { deletedAt: null } }),
      db.tool.count({ where: { deletedAt: null } }),
      db.vehicle.count({ where: { deletedAt: null } }),
      db.bidOpportunity.count({ where: { deletedAt: null } }),
      db.intranetResource.count({ where: { deletedAt: null } }),
    ]);

  const coreCounts: [string, number][] = [
    ["Clients", clients],
    ["Projects", projects],
    ["Tasks", tasks],
    ["Contracts", contracts],
    ["Certifications", certs],
    ["Suppliers", suppliers],
    ["Subcontractors", subs],
    ["Partnerships", partners],
    ["Tools", tools],
    ["Vehicles", vehicles],
    ["Bids", bids],
    ["Intranet resources", intranet],
  ];

  // ── Role distribution (legacy-role check for the enum collapse) ──
  const roleCounts = await db.user.groupBy({
    by: ["role"],
    _count: { _all: true },
    orderBy: { role: "asc" },
  });
  const legacyRoles = new Set(["DEVELOPER", "VIEWER", "GUEST"]);
  const legacyUserCount = roleCounts
    .filter((r) => legacyRoles.has(r.role))
    .reduce((sum, r) => sum + r._count._all, 0);

  // ── ProjectMember vs Assignment overlap ──
  const [memberRows, assignmentRows] = await Promise.all([
    db.projectMember.findMany({ select: { projectId: true, userId: true } }),
    db.assignment.findMany({
      where: { projectId: { not: null } },
      select: { projectId: true, employeeId: true },
    }),
  ]);
  const memberKeys = new Set(memberRows.map((m) => `${m.projectId}:${m.userId}`));
  const assignmentKeys = new Set(assignmentRows.map((a) => `${a.projectId}:${a.employeeId}`));
  const membersOnly = Array.from(memberKeys).filter((k) => !assignmentKeys.has(k)).length;
  const assignmentsOnly = Array.from(assignmentKeys).filter((k) => !memberKeys.has(k)).length;
  const inBoth = Array.from(memberKeys).filter((k) => assignmentKeys.has(k)).length;

  // ── Storage + email ──
  const [filesByDriver, filesBytes, emailByDriver] = await Promise.all([
    db.file.groupBy({ by: ["storageDriver"], _count: { _all: true } }),
    db.file.aggregate({ _sum: { size: true } }),
    db.emailLog.groupBy({ by: ["driver", "status"], _count: { _all: true } }),
  ]);
  const totalBytes = filesBytes._sum.size ?? 0;

  const fmtDate = (d: Date | null) => (d ? format(d, "MMM d, yyyy") : "never");
  const fmtBytes = (n: number) => {
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  return (
    <div>
      <PageHeader
        title="Usage Census"
        description="Live counts backing the delete-dead-weight and data-model decisions — nothing here writes anything"
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-4 w-4" />
              Deletion candidates (audit P5)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-3">
              A zero (or ancient last-activity) row is a subsystem that can likely be deleted
              outright — code, admin pages, and permissions with it.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Subsystem</th>
                    <th className="py-2 pr-3 font-medium text-right">Rows</th>
                    <th className="py-2 pr-3 font-medium">Last activity</th>
                    <th className="py-2 font-medium">Verdict hint</th>
                  </tr>
                </thead>
                <tbody>
                  {p5Rows.map((row) => (
                    <tr key={row.label} className="border-b border-border last:border-0">
                      <td className="py-2 pr-3">
                        {row.label}
                        {row.note && <p className="text-xs text-muted-foreground">{row.note}</p>}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums font-medium">{row.count}</td>
                      <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">{fmtDate(row.lastActivity)}</td>
                      <td className="py-2">
                        {row.count === 0 ? (
                          <Badge variant="destructive">unused — delete?</Badge>
                        ) : (
                          <Badge variant="success">holds data</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Role distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              {roleCounts.map((r) => (
                <div key={r.role} className="flex items-center justify-between">
                  <span className={legacyRoles.has(r.role) ? "text-warning font-medium" : ""}>
                    {r.role}
                    {legacyRoles.has(r.role) && " (legacy)"}
                  </span>
                  <span className="tabular-nums font-medium">{r._count._all}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-4">
              {legacyUserCount === 0
                ? "No users on legacy roles — the enum collapse migration is safe to run whenever."
                : `${legacyUserCount} user${legacyUserCount === 1 ? "" : "s"} still on legacy roles — reassign them (Admin → Users) before collapsing the enum.`}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GitMerge className="h-4 w-4" />
              ProjectMember vs Assignment
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span>Member rows (legacy team relation)</span>
                <span className="tabular-nums font-medium">{memberKeys.size}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Assignment rows (staffing, with project)</span>
                <span className="tabular-nums font-medium">{assignmentKeys.size}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>In both systems</span>
                <span className="tabular-nums font-medium">{inBoth}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className={membersOnly > 0 ? "text-warning font-medium" : ""}>Member-only (would need backfill)</span>
                <span className="tabular-nums font-medium">{membersOnly}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Assignment-only (fine — target state)</span>
                <span className="tabular-nums font-medium">{assignmentsOnly}</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-4">
              The merge migration turns member-only rows into assignments, then drops
              ProjectMember. {membersOnly === 0 ? "Nothing to backfill — cheap merge." : "The backfill needs role/FTE defaults for the member-only rows."}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HardDrive className="h-4 w-4" />
              Storage & email
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              {filesByDriver.map((f) => (
                <div key={f.storageDriver ?? "legacy"} className="flex items-center justify-between">
                  <span>
                    Files on <span className="font-mono">{f.storageDriver ?? "legacy-url"}</span>
                    {f.storageDriver === "local" && (
                      <span className="text-warning"> — dies with the container; move to S3</span>
                    )}
                  </span>
                  <span className="tabular-nums font-medium">{f._count._all}</span>
                </div>
              ))}
              <div className="flex items-center justify-between border-t border-border pt-2">
                <span>Total stored bytes</span>
                <span className="tabular-nums font-medium">{fmtBytes(totalBytes)}</span>
              </div>
              {emailByDriver.map((e) => (
                <div key={`${e.driver}-${e.status}`} className="flex items-center justify-between">
                  <span>
                    Email <span className="font-mono">{e.driver}</span> / {e.status}
                    {e.driver === "log" && <span className="text-warning"> — nothing actually sent</span>}
                  </span>
                  <span className="tabular-nums font-medium">{e._count._all}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Core modules (keepers, for contrast)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
              {coreCounts.map(([label, count]) => (
                <div key={label} className="rounded border border-border bg-muted p-3">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-lg font-semibold tabular-nums">{count}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
