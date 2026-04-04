import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDataSource } from "@/lib/widget-builder/data-source-registry";
import { executeDataSourceQuery } from "@/lib/widget-builder/data-source-executor";
import type { WidgetConfig, DisplayType } from "@/lib/widget-builder/widget-config-types";
import { DisplayStatCard } from "./custom/display-stat-card";
import { DisplayCounterRow } from "./custom/display-counter-row";
import { DisplayList } from "./custom/display-list";
import { DisplayTable } from "./custom/display-table";
import { DisplayProgressBar } from "./custom/display-progress-bar";
import { DisplayBarChart } from "./custom/display-bar-chart";
import { DisplayStatusBoard } from "./custom/display-status-board";
import type { DisplayProps } from "@/lib/widget-builder/widget-config-types";

const DISPLAY_MAP: Record<DisplayType, React.ComponentType<DisplayProps>> = {
  "stat-card": DisplayStatCard,
  "counter-row": DisplayCounterRow,
  "list": DisplayList,
  "table": DisplayTable,
  "progress-bar": DisplayProgressBar,
  "bar-chart": DisplayBarChart,
  "status-board": DisplayStatusBoard,
};

interface Props {
  widgetId: string;
  userId: string;
}

export async function CustomWidgetRenderer({ widgetId }: Props) {
  const widget = await db.customWidget.findUnique({ where: { id: widgetId } });
  if (!widget) {
    return (
      <Card className="h-full">
        <CardContent className="p-4">
          <p className="text-sm text-muted-foreground">Widget not found</p>
        </CardContent>
      </Card>
    );
  }

  let config: WidgetConfig;
  try {
    config = JSON.parse(widget.config) as WidgetConfig;
  } catch {
    return (
      <Card className="h-full">
        <CardContent className="p-4">
          <p className="text-sm text-destructive">Invalid widget configuration</p>
        </CardContent>
      </Card>
    );
  }

  const ds = getDataSource(config.dataSourceId);
  if (!ds) {
    return (
      <Card className="h-full">
        <CardContent className="p-4">
          <p className="text-sm text-destructive">Data source &quot;{config.dataSourceId}&quot; not found</p>
        </CardContent>
      </Card>
    );
  }

  const data = await executeDataSourceQuery({
    dataSourceId: config.dataSourceId,
    filters: config.filters || [],
    sort: config.sort || ds.defaultSort,
    limit: config.limit || 20,
    aggregation: config.aggregation,
  });

  const DisplayComponent = DISPLAY_MAP[config.displayType] || DisplayList;

  return (
    <Card className="h-full">
      {config.showHeader !== false && (
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">{config.title || widget.name}</CardTitle>
            {config.linkTo && (
              <a href={config.linkTo} className="text-xs text-primary hover:underline">View all</a>
            )}
          </div>
        </CardHeader>
      )}
      <CardContent className={config.showHeader !== false ? "" : "p-4"}>
        <DisplayComponent config={config} data={data} fields={ds.fields} />
      </CardContent>
    </Card>
  );
}
