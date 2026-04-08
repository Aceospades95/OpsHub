import { isGlobalWidget, isCustomWidget } from "@/lib/widget-registry";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CustomWidgetRenderer } from "./custom-widget-renderer";
import { WidgetKpiCard } from "./widget-kpi-card";
import { WidgetProgressTracker } from "./widget-progress-tracker";
import { WidgetStatsSummary } from "./widget-stats-summary";
import { WidgetAnnouncements } from "./widget-announcements";
import { WidgetTeamDirectory } from "./widget-team-directory";
import { WidgetRecentComments } from "./widget-recent-comments";
import { WidgetQuickLinks } from "./widget-quick-links";
import { WidgetCalendar } from "./widget-calendar";
import { WidgetMyTasks } from "./widget-my-tasks";
import { WidgetRecentActivity } from "./widget-recent-activity";
import { WidgetNotes } from "./widget-notes";
import { WidgetRecentProjects } from "./widget-recent-projects";
import { WidgetRecentContracts } from "./widget-recent-contracts";
import { WidgetRecentDocuments } from "./widget-recent-documents";
import { WidgetProjectStatus } from "./widget-project-status";
import { WidgetContractAlerts } from "./widget-contract-alerts";
import { WidgetCountdown } from "./widget-countdown";
import { WidgetEmbed } from "./widget-embed";
import { WidgetMarkdown } from "./widget-markdown";

interface WidgetRendererProps {
  widgetId: string;
  userId: string;
}

const WIDGET_MAP: Record<string, React.ComponentType<{ userId: string }>> = {
  "widget-kpi-card": WidgetKpiCard,
  "widget-progress-tracker": WidgetProgressTracker,
  "widget-stats-summary": WidgetStatsSummary,
  "widget-announcements": WidgetAnnouncements,
  "widget-team-directory": WidgetTeamDirectory,
  "widget-recent-comments": WidgetRecentComments,
  "widget-quick-links": WidgetQuickLinks,
  "widget-calendar": WidgetCalendar,
  "widget-my-tasks": WidgetMyTasks,
  "widget-recent-activity": WidgetRecentActivity,
  "widget-notes": WidgetNotes,
  "widget-recent-projects": WidgetRecentProjects,
  "widget-recent-contracts": WidgetRecentContracts,
  "widget-recent-documents": WidgetRecentDocuments,
  "widget-project-status": WidgetProjectStatus,
  "widget-contract-alerts": WidgetContractAlerts,
  "widget-countdown": WidgetCountdown,
  "widget-embed": WidgetEmbed,
  "widget-markdown": WidgetMarkdown,
};

export async function WidgetRenderer({ widgetId, userId }: WidgetRendererProps) {
  // Custom widgets built via Widget Builder
  if (isCustomWidget(widgetId)) {
    const actualId = widgetId.replace("custom-widget-", "");
    return <CustomWidgetRenderer widgetId={actualId} userId={userId} />;
  }

  if (!isGlobalWidget(widgetId)) return null;

  const Component = WIDGET_MAP[widgetId];
  if (!Component) {
    return (
      <Card className="h-full">
        <CardHeader><CardTitle className="text-sm">Unknown Widget</CardTitle></CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">Widget &quot;{widgetId}&quot; not found</p>
        </CardContent>
      </Card>
    );
  }

  return <Component userId={userId} />;
}
