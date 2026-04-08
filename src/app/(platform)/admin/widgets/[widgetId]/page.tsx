import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { getCustomWidget } from "@/actions/custom-widgets";
import { PageHeader } from "@/components/layout/page-header";
import { WidgetBuilder } from "../widget-builder";
import type { WidgetConfig } from "@/lib/widget-builder/widget-config-types";

interface Props {
  params: Promise<{ widgetId: string }>;
}

export default async function EditWidgetPage({ params }: Props) {
  const { widgetId } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN" && session.user.role !== "DEVELOPER") redirect("/dashboard");

  const widget = await getCustomWidget(widgetId);
  if (!widget) notFound();

  let config: WidgetConfig | undefined;
  try {
    config = JSON.parse(widget.config) as WidgetConfig;
  } catch {
    // Will use default config
  }

  return (
    <div>
      <PageHeader title={`Edit: ${widget.name}`} description="Modify widget configuration" />
      <WidgetBuilder
        widgetId={widget.id}
        initialName={widget.name}
        initialDescription={widget.description || ""}
        initialConfig={config}
        initialIcon={widget.icon || "BarChart3"}
        initialCategory={widget.category}
        initialIsPublished={widget.isPublished}
      />
    </div>
  );
}
