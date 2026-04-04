import type { DisplayProps } from "@/lib/widget-builder/widget-config-types";

export function DisplayProgressBar({ config, data }: DisplayProps) {
  const current = typeof data.aggregate === "number" ? data.aggregate : 0;
  const goal = config.goalValue || 100;
  const pct = goal > 0 ? Math.min(100, Math.round((current / goal) * 100)) : 0;

  return (
    <div className="flex flex-col items-center justify-center h-full p-4">
      <div className="w-full mb-3">
        <div className="flex justify-between text-sm mb-1">
          <span className="text-muted-foreground">{config.title || "Progress"}</span>
          <span className="font-semibold">{current} / {goal}</span>
        </div>
        <div className="h-4 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <div className="text-2xl font-bold">{pct}%</div>
    </div>
  );
}
