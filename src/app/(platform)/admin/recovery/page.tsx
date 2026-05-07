import { redirect } from "next/navigation";
import { Trash2 } from "lucide-react";

import { requireAuth } from "@/lib/permissions";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { listSoftDeletedRows } from "@/actions/recovery";
import { DEFAULT_RETENTION_DAYS } from "@/lib/soft-delete";
import { formatCalendarDate } from "@/lib/dates";

import { RecoveryRowActions } from "./recovery-row-actions";

/**
 * Admin-only recovery bin for soft-deleted entities.
 *
 * Lists every row across the soft-delete registry that has a non-null
 * deletedAt. Each row has Restore (clears deletedAt — row reappears in
 * list views) and Delete forever (immediate hard-delete — admin
 * override for the 30-day window). The PURGE_SOFT_DELETED scheduled
 * task hard-deletes anything past the retention window automatically.
 */
export default async function RecoveryPage() {
  const user = await requireAuth();
  if (user.role !== "ADMIN") {
    redirect("/admin");
  }

  const rows = await listSoftDeletedRows();
  const retentionLabel = `${DEFAULT_RETENTION_DAYS} days`;

  // Group by entity type so the page reads as
  //   Projects (3)
  //     <row>
  //     <row>
  //   Clients (1)
  //     <row>
  // — easier to scan than one big chronological list.
  const byEntity = new Map<string, typeof rows>();
  for (const row of rows) {
    const arr = byEntity.get(row.entityType) ?? [];
    arr.push(row);
    byEntity.set(row.entityType, arr);
  }

  return (
    <div>
      <PageHeader
        title="Recovery bin"
        description={`Soft-deleted records auto-purge after ${retentionLabel}. Restore to bring them back into the lists, or delete forever to skip the wait.`}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={Trash2}
          title="Recovery bin is empty"
          description="Anything you delete from a list page lands here for 30 days before being purged."
        />
      ) : (
        <div className="space-y-6">
          {Array.from(byEntity.entries()).map(([entityType, group]) => (
            <Card key={entityType}>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  {group[0]?.pluralLabel ?? entityType}
                  <Badge variant="secondary" className="text-[10px]">
                    {group.length}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 border-y border-border">
                    <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-2 font-semibold">Name</th>
                      <th className="px-4 py-2 font-semibold w-32">Deleted</th>
                      <th className="px-4 py-2 font-semibold w-32">
                        Auto-purge in
                      </th>
                      <th className="px-4 py-2 font-semibold w-56 text-right">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.map((row) => (
                      <tr
                        key={`${row.entityType}-${row.id}`}
                        className="border-b border-border/40 last:border-b-0"
                      >
                        <td className="px-4 py-2 truncate max-w-md" title={row.label}>
                          {row.label}
                        </td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">
                          {formatCalendarDate(row.deletedAt, "MMM d, yyyy")}
                        </td>
                        <td className="px-4 py-2 text-xs">
                          {row.daysLeft === 0 ? (
                            <span className="text-destructive">Today</span>
                          ) : row.daysLeft <= 3 ? (
                            <span className="text-amber-600">
                              {row.daysLeft} day{row.daysLeft === 1 ? "" : "s"}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">
                              {row.daysLeft} day{row.daysLeft === 1 ? "" : "s"}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          <RecoveryRowActions
                            entityType={row.entityType}
                            id={row.id}
                            label={row.label}
                            singularLabel={row.singularLabel}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
