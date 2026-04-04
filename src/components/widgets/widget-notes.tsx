import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StickyNote } from "lucide-react";

export async function WidgetNotes({ userId: _userId }: { userId: string }) {
  return (
    <Card className="h-full bg-yellow-50/50 border-yellow-200/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <StickyNote className="h-4 w-4 text-yellow-600" /> Sticky Note
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground italic">
          Click to edit this note. Use it for quick reminders, important info, or team messages.
        </p>
        <p className="text-xs text-muted-foreground mt-3">
          (Editable notes coming soon)
        </p>
      </CardContent>
    </Card>
  );
}
