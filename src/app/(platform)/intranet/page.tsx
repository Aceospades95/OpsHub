import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Globe, Pin } from "lucide-react";
import Link from "next/link";
import { IntranetCreateButton } from "./intranet-create-button";
import { IntranetCategoryAdd } from "./intranet-category-add";

const categoryLabels: Record<string, string> = {
  EXPENSE_REPORT: "Expense Reports",
  TIME_OFF: "Time Off",
  ORG_CHART: "Org Chart",
  ANNOUNCEMENT: "Announcements",
  HR_POLICY: "HR Policies",
  SOP: "SOPs",
  GENERAL_RESOURCE: "General Resources",
  FORM: "Forms",
  OTHER: "Other",
};

export default async function IntranetPage() {
  const user = await requireAuth();

  const perms = await resolveModulePerms(user.id, user.role, "intranet");

  const resources = await db.intranetResource.findMany({
    orderBy: [{ pinned: "desc" }, { sortOrder: "asc" }, { updatedAt: "desc" }],
  });

  // Group by category
  const grouped = new Map<string, typeof resources>();
  for (const r of resources) {
    const cat = r.category;
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(r);
  }

  return (
    <div>
      <PageHeader
        title="Intranet"
        description="Company resources and announcements"
        actions={perms.canCreate ? <IntranetCreateButton /> : undefined}
      />

      {resources.length === 0 ? (
        <EmptyState icon={Globe} title="No resources yet" description="Create your first intranet resource" />
      ) : (
        <div className="space-y-8">
          {Array.from(grouped.entries()).map(([category, items]) => (
            <div key={category}>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold">{categoryLabels[category] || category}</h2>
                {perms.canCreate && (
                  <IntranetCategoryAdd category={category} categoryLabel={categoryLabels[category] || category} />
                )}
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((resource) => (
                  <Link key={resource.id} href={`/intranet/${resource.id}`}>
                    <Card className="hover:shadow-lg transition-shadow h-full">
                      <CardContent className="p-5">
                        <div className="flex items-start justify-between mb-2">
                          <h3 className="font-semibold text-foreground">{resource.title}</h3>
                          <div className="flex gap-1">
                            {resource.pinned && <Pin className="h-4 w-4 text-primary" />}
                          </div>
                        </div>
                        {resource.description && (
                          <p className="text-sm text-muted-foreground line-clamp-2">{resource.description}</p>
                        )}
                        <div className="flex gap-2 mt-3">
                          {resource.published ? (
                            <Badge variant="success">Published</Badge>
                          ) : (
                            <Badge variant="secondary">Draft</Badge>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
