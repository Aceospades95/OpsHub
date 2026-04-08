import type { DisplayProps } from "@/lib/widget-builder/widget-config-types";

const COLUMN_COLORS = [
  { text: "text-blue-700", bg: "bg-blue-50" },
  { text: "text-green-700", bg: "bg-green-50" },
  { text: "text-yellow-700", bg: "bg-yellow-50" },
  { text: "text-purple-700", bg: "bg-purple-50" },
  { text: "text-orange-700", bg: "bg-orange-50" },
  { text: "text-pink-700", bg: "bg-pink-50" },
];

export function DisplayStatusBoard({ config, data, fields }: DisplayProps) {
  const groupField = config.groupByField || fields.find((f) => f.type === "enum")?.key || "";
  const labelField = config.labelField || fields.find((f) => f.type === "string")?.key || "";

  // Group rows by the group field
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const row of data.rows) {
    const key = String(row[groupField] ?? "Other");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  if (groups.size === 0) {
    return <p className="text-sm text-muted-foreground p-2">No data</p>;
  }

  const columns = Array.from(groups.entries());

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(columns.length, 5)}, 1fr)` }}>
      {columns.map(([status, items], i) => (
        <div key={status}>
          <div className={`px-2 py-1 rounded-t-md text-xs font-semibold ${COLUMN_COLORS[i % COLUMN_COLORS.length].text} ${COLUMN_COLORS[i % COLUMN_COLORS.length].bg}`}>
            {status.replace(/_/g, " ")} ({items.length})
          </div>
          <div className="border border-t-0 border-border rounded-b-md p-1 space-y-1 min-h-[40px]">
            {items.slice(0, 8).map((row, j) => (
              <div key={j} className="px-2 py-1 text-xs rounded hover:bg-muted truncate">
                {String(row[labelField] ?? `Item ${j + 1}`)}
              </div>
            ))}
            {items.length > 8 && (
              <p className="px-2 text-[10px] text-muted-foreground">+{items.length - 8} more</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
