import { requireAuth } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ShieldQuestion } from "lucide-react";
import { format } from "date-fns";
import { AccessRequestActions } from "./access-request-actions";

async function resolveEntityName(entityType: string, entityId: string): Promise<string | null> {
  switch (entityType) {
    case "project": {
      const p = await db.project.findFirst({ where: { id: entityId, deletedAt: null }, select: { name: true } });
      return p?.name || null;
    }
    case "client": {
      const c = await db.client.findFirst({ where: { id: entityId, deletedAt: null }, select: { name: true } });
      return c?.name || null;
    }
    case "contract": {
      const c = await db.contract.findFirst({ where: { id: entityId, deletedAt: null }, select: { title: true } });
      return c?.title || null;
    }
    case "tool": {
      const t = await db.tool.findFirst({ where: { id: entityId, deletedAt: null }, select: { name: true } });
      return t?.name || null;
    }
    case "certification": {
      const c = await db.certification.findFirst({ where: { id: entityId, deletedAt: null }, select: { name: true } });
      return c?.name || null;
    }
    default:
      return null;
  }
}

export const metadata = { title: "Access Requests · OpsHub" };

export default async function AccessRequestsPage() {
  const user = await requireAuth();
  if (user.role !== "ADMIN") redirect("/dashboard");

  const [pending, resolved] = await Promise.all([
    db.accessRequest.findMany({
      where: { status: "PENDING" },
      include: {
        requester: { select: { id: true, name: true, email: true, role: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    db.accessRequest.findMany({
      where: { status: { in: ["APPROVED", "DENIED"] } },
      include: {
        requester: { select: { id: true, name: true, email: true } },
        reviewer: { select: { id: true, name: true } },
      },
      orderBy: { reviewedAt: "desc" },
      take: 50,
    }),
  ]);

  const pendingWithNames = await Promise.all(
    pending.map(async (r) => {
      const resolvedName = r.entityType && r.entityId
        ? await resolveEntityName(r.entityType, r.entityId)
        : null;
      return { ...r, resolvedEntityName: resolvedName || r.entityLabel };
    })
  );

  return (
    <div>
      <PageHeader
        title="Access Requests"
        description="Review and approve pending access requests from team members"
      />

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Pending
              {pending.length > 0 && (
                <Badge variant="warning">{pending.length}</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {pendingWithNames.length === 0 ? (
              <EmptyState
                icon={ShieldQuestion}
                title="No pending requests"
                description="Access requests from team members will appear here"
              />
            ) : (
              <div className="divide-y">
                {pendingWithNames.map((r) => (
                  <div key={r.id} className="py-4 first:pt-0 last:pb-0">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {r.requester.name || r.requester.email}
                          <Badge variant="outline" className="ml-2 text-[10px]">{r.requester.role}</Badge>
                        </p>
                        <p className="text-sm text-muted-foreground mt-0.5">
                          {r.entityType && r.resolvedEntityName ? (
                            <>
                              Requesting access to {r.entityType}:{" "}
                              <strong>{r.resolvedEntityName}</strong>
                            </>
                          ) : r.module ? (
                            <>
                              Requesting access to the <strong>{r.module}</strong> module
                            </>
                          ) : (
                            "General access request"
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {format(r.createdAt, "MMM d, yyyy 'at' h:mm a")}
                        </p>
                      </div>
                      <AccessRequestActions requestId={r.id} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {resolved.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Recently Resolved</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="divide-y">
                {resolved.map((r) => (
                  <div key={r.id} className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm">
                        <span className="font-medium">{r.requester.name || r.requester.email}</span>
                        {" — "}
                        {r.entityLabel || r.module || "general"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {r.reviewer?.name || "System"} &middot;{" "}
                        {r.reviewedAt ? format(r.reviewedAt, "MMM d, yyyy") : ""}
                      </p>
                    </div>
                    <Badge variant={r.status === "APPROVED" ? "success" : "destructive"}>
                      {r.status}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
