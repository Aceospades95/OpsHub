import { Card, CardContent } from "@/components/ui/card";
import { Timer } from "lucide-react";

export async function WidgetCountdown({ userId: _userId }: { userId: string }) {
  // Placeholder — configurable date coming soon
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + 30); // 30 days from now

  const now = new Date();
  const diff = targetDate.getTime() - now.getTime();
  const days = Math.max(0, Math.floor(diff / 86400000));
  const hours = Math.max(0, Math.floor((diff % 86400000) / 3600000));

  return (
    <Card className="h-full">
      <CardContent className="p-4 flex flex-col items-center justify-center h-full">
        <Timer className="h-6 w-6 text-primary mb-2" />
        <div className="text-3xl font-bold">{days}</div>
        <div className="text-sm text-muted-foreground">days remaining</div>
        <p className="text-xs text-muted-foreground mt-2">(Configure target date)</p>
      </CardContent>
    </Card>
  );
}
