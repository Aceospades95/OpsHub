import { requireAuth } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { listCustomWidgets } from "@/actions/custom-widgets";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Puzzle } from "lucide-react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { WidgetListActions } from "./widget-list-actions";

export const metadata = { title: "Widget Builder · OpsHub" };

export default async function WidgetListPage() {
  const user = await requireAuth();
  if (user.role !== "ADMIN" && user.role !== "DEVELOPER") redirect("/dashboard");

  const widgets = await listCustomWidgets();

  return (
    <div>
      <PageHeader
        title="Widget Builder"
        description="Create and manage custom widgets"
        actions={
          <Link
            href="/admin/widgets/new"
            className="inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Puzzle className="h-4 w-4" />
            Create Widget
          </Link>
        }
      />

      {widgets.length === 0 ? (
        <EmptyState
          icon={Puzzle}
          title="No custom widgets"
          description="Create your first widget to display data from any source"
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {widgets.map((w) => {
            let config: { displayType?: string; dataSourceId?: string } = {};
            try { config = JSON.parse(w.config); } catch { /* empty */ }

            return (
              <Card key={w.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1 min-w-0">
                      <Link href={`/admin/widgets/${w.id}`} className="font-semibold text-foreground hover:text-primary">
                        {w.name}
                      </Link>
                      {w.description && (
                        <p className="text-sm text-muted-foreground line-clamp-1 mt-0.5">{w.description}</p>
                      )}
                    </div>
                    <WidgetListActions widgetId={w.id} isPublished={w.isPublished} />
                  </div>

                  <div className="flex flex-wrap gap-2 mt-3">
                    {w.isPublished ? (
                      <Badge variant="success">Published</Badge>
                    ) : (
                      <Badge variant="secondary">Draft</Badge>
                    )}
                    {config.dataSourceId && (
                      <Badge variant="outline">{config.dataSourceId}</Badge>
                    )}
                    {config.displayType && (
                      <Badge variant="outline">{config.displayType}</Badge>
                    )}
                    <Badge variant="outline">{w.category}</Badge>
                  </div>

                  <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
                    <span>by {w.createdBy.name}</span>
                    <span>{formatDistanceToNow(w.updatedAt, { addSuffix: true })}</span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
