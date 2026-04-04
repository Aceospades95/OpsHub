import type { DisplayProps } from "@/lib/widget-builder/widget-config-types";

const COLORS = [
  "text-blue-600 bg-blue-50",
  "text-green-600 bg-green-50",
  "text-yellow-600 bg-yellow-50",
  "text-purple-600 bg-purple-50",
  "text-orange-600 bg-orange-50",
  "text-pink-600 bg-pink-50",
  "text-cyan-600 bg-cyan-50",
];

export function DisplayCounterRow({ data }: DisplayProps) {
  const counts = typeof data.aggregate === "object" ? data.aggregate : {};
  const entries = Object.entries(counts);

  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground p-2">No data</p>;
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 p-1">
      {entries.map(([label, count], i) => (
        <div key={label} className={`rounded-lg p-3 text-center ${COLORS[i % COLORS.length]}`}>
          <div className="text-2xl font-bold">{count}</div>
          <div className="text-xs font-medium mt-0.5 truncate">{label.replace(/_/g, " ")}</div>
        </div>
      ))}
    </div>
  );
}
