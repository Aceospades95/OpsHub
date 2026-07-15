import type { DisplayProps } from "@/lib/widget-builder/widget-config-types";

const BAR_COLORS = [
  "bg-blue-500", "bg-green-500", "bg-yellow-500", "bg-purple-500",
  "bg-orange-500", "bg-pink-500", "bg-cyan-500", "bg-red-500",
];

export function DisplayBarChart({ data }: DisplayProps) {
  const counts = typeof data.aggregate === "object" ? data.aggregate : {};
  const entries = Object.entries(counts).sort(([, a], [, b]) => b - a);
  const maxVal = Math.max(...entries.map(([, v]) => v), 1);

  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground p-2">No data</p>;
  }

  return (
    <div className="space-y-2 p-1">
      {entries.map(([label, count], i) => (
        <div key={label}>
          <div className="flex justify-between text-xs mb-0.5">
            <span className="text-muted-foreground truncate min-w-0" title={label.replace(/_/g, " ")}>
              {label.replace(/_/g, " ")}
            </span>
            <span className="font-medium ml-2 shrink-0 tabular-nums">{count}</span>
          </div>
          <div className="h-5 bg-muted rounded overflow-hidden">
            <div
              className={`h-full rounded transition-all ${BAR_COLORS[i % BAR_COLORS.length]}`}
              style={{ width: `${(count / maxVal) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
