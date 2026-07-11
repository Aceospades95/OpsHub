import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Archive } from "lucide-react";

/**
 * Stand-in for widget types that were retired before their config layer
 * shipped (notes / countdown / markdown — see the registry comment in
 * lib/widget-registry.ts). Rendering a neutral notice instead of the old
 * "coming soon" placeholders keeps existing layouts from crashing while
 * making clear the card shows no data and is safe to remove.
 */
export function RetiredWidgetCard({ widgetId }: { widgetId: string }) {
  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground">
          <Archive className="h-4 w-4" /> Retired Widget
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">
          The &quot;{widgetId}&quot; widget has been retired and no longer
          shows any data. Remove it from this layout.
        </p>
      </CardContent>
    </Card>
  );
}
