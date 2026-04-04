import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText } from "lucide-react";

export async function WidgetMarkdown({ userId: _userId }: { userId: string }) {
  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <FileText className="h-4 w-4" /> Markdown Content
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-sm text-muted-foreground space-y-2">
          <p>Use this widget to display custom markdown content — welcome messages, SOPs, onboarding guides, or any formatted text.</p>
          <p className="text-xs">(Configurable content coming soon)</p>
        </div>
      </CardContent>
    </Card>
  );
}
