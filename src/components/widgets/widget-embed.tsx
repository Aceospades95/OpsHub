import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Globe } from "lucide-react";

export async function WidgetEmbed({ userId: _userId }: { userId: string }) {
  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Globe className="h-4 w-4" /> Embed / iFrame
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-center h-full min-h-[100px] border-2 border-dashed border-border rounded-lg">
          <p className="text-sm text-muted-foreground">
            Configure a URL to embed external content here
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
