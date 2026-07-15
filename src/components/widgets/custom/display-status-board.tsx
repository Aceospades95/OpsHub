import type { DisplayProps } from "@/lib/widget-builder/widget-config-types";

// Distinct column hues (intentional); mid-tone text on a /10 alpha
// tint stays readable on both light and dark admin themes.
const COLUMN_COLORS = [
  { text: "text-blue-600", bg: "bg-blue-500/10" },
  { text: "text-green-600", bg: "bg-green-500/10" },
  { text: "text-yellow-600", bg: "bg-yellow-500/10" },
  { text: "text-purple-600", bg: "bg-purple-500/10" },
  { text: "text-orange-600", bg: "bg-orange-500/10" },
  { text: "text-pink-600", bg: "bg-pink-500/10" },
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
    // minmax(0, 1fr) lets columns shrink below their content width so a
    // long status label can't blow the grid out of the widget.
    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(columns.length, 5)}, minmax(0, 1fr))` }}>
      {columns.map(([status, items], i) => (
        <div key={status} className="min-w-0">
          <div
            title={`${status.replace(/_/g, " ")} (${items.length})`}
            className={`px-2 py-1 rounded-t-md text-xs font-semibold truncate ${COLUMN_COLORS[i % COLUMN_COLORS.length].text} ${COLUMN_COLORS[i % COLUMN_COLORS.length].bg}`}
          >
            {status.replace(/_/g, " ")} ({items.length})
          </div>
          <div className="border border-t-0 border-border rounded-b-md p-1 space-y-1 min-h-[40px]">
            {items.slice(0, 8).map((row, j) => (
              <div key={j} className="px-2 py-1 text-xs rounded hover:bg-muted truncate" title={String(row[labelField] ?? "")}>
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
