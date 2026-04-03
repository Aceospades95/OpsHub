import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getCustomWidgets } from "@/actions/widgets";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { WidgetBuilder } from "./widget-builder";

const TYPE_BADGE_VARIANT: Record<string, "default" | "secondary" | "success" | "warning"> = {
  stat: "default",
  embed: "success",
  markdown: "secondary",
  "data-list": "warning",
};

const TYPE_LABELS: Record<string, string> = {
  stat: "Stat Counter",
  embed: "Embed",
  markdown: "Text Block",
  "data-list": "Data List",
};

export default async function AdminWidgetsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN" && session.user.role !== "DEVELOPER") {
    redirect("/dashboard");
  }

  const widgets = await getCustomWidgets();

  return (
    <div>
      <PageHeader
        title="Widget Builder"
        description="Create and manage reusable custom widgets for dashboards"
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/admin/users"
              className="inline-flex items-center justify-center rounded font-medium transition-colors h-8 px-3 text-sm border border-border bg-background hover:bg-muted text-foreground"
            >
              Back to Admin
            </Link>
            <WidgetBuilder mode="create" />
          </div>
        }
      />

      {widgets.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <p className="text-muted-foreground">
              No custom widgets yet. Click &quot;Create Widget&quot; to build your first one.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {widgets.map((widget) => {
            let configSummary = "";
            try {
              const cfg = JSON.parse(widget.config);
              if (widget.type === "stat" && cfg.model) {
                configSummary = `Model: ${cfg.model}`;
              } else if (widget.type === "embed" && cfg.url) {
                configSummary = cfg.url.length > 40 ? cfg.url.slice(0, 40) + "..." : cfg.url;
              } else if (widget.type === "data-list" && cfg.model) {
                configSummary = `Model: ${cfg.model}, Limit: ${cfg.limit || 5}`;
              } else if (widget.type === "markdown" && cfg.content) {
                configSummary =
                  cfg.content.length > 60
                    ? cfg.content.slice(0, 60) + "..."
                    : cfg.content;
              }
            } catch {
              configSummary = "";
            }

            return (
              <Card key={widget.id}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h3 className="text-sm font-semibold text-foreground truncate">
                      {widget.name}
                    </h3>
                    <Badge variant={TYPE_BADGE_VARIANT[widget.type] || "secondary"}>
                      {TYPE_LABELS[widget.type] || widget.type}
                    </Badge>
                  </div>
                  {widget.description && (
                    <p className="text-xs text-muted-foreground mb-2 line-clamp-2">
                      {widget.description}
                    </p>
                  )}
                  {configSummary && (
                    <p className="text-xs text-muted-foreground/70 mb-3 font-mono truncate">
                      {configSummary}
                    </p>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      by {(widget as Record<string, unknown> & { createdBy?: { name: string } }).createdBy?.name || "Unknown"}
                    </span>
                    <div className="flex items-center gap-1">
                      <WidgetBuilder mode="edit" widget={widget} />
                      <WidgetBuilder mode="delete" widget={widget} />
                    </div>
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
