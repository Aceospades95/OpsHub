import type { DisplayProps } from "@/lib/widget-builder/widget-config-types";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";

function formatValue(val: unknown, type: string): string {
  if (val == null) return "—";
  if (type === "date" && (val instanceof Date || typeof val === "string")) {
    try { return format(new Date(val as string), "MMM d, yyyy"); } catch { return String(val); }
  }
  if (type === "boolean") return val ? "Yes" : "No";
  return String(val);
}

export function DisplayList({ config, data, fields }: DisplayProps) {
  const columns = config.columns?.length ? config.columns : fields.slice(0, 3).map((f) => f.key);
  const labelField = config.labelField || columns[0];
  const fieldMap = new Map(fields.map((f) => [f.key, f]));

  if (data.rows.length === 0) {
    return <p className="text-sm text-muted-foreground p-2">No items found</p>;
  }

  return (
    <div className="space-y-1">
      {data.rows.map((row, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-muted transition-colors">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{String(row[labelField] ?? "")}</p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {columns.filter((c) => c !== labelField).map((col) => {
                const field = fieldMap.get(col);
                const val = row[col];
                if (field?.type === "enum" && val) {
                  return <Badge key={col} variant="outline" className="text-[10px]">{String(val)}</Badge>;
                }
                return <span key={col}>{formatValue(val, field?.type || "string")}</span>;
              })}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
