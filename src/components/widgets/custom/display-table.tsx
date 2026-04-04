import type { DisplayProps } from "@/lib/widget-builder/widget-config-types";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";

function formatValue(val: unknown, type: string): React.ReactNode {
  if (val == null) return <span className="text-muted-foreground">—</span>;
  if (type === "date" && (val instanceof Date || typeof val === "string")) {
    try { return format(new Date(val as string), "MMM d, yyyy"); } catch { return String(val); }
  }
  if (type === "boolean") return val ? <Badge variant="success">Yes</Badge> : <Badge variant="outline">No</Badge>;
  if (type === "enum") return <Badge variant="outline">{String(val).replace(/_/g, " ")}</Badge>;
  if (type === "number") return Number(val).toLocaleString();
  return String(val);
}

export function DisplayTable({ config, data, fields }: DisplayProps) {
  const columns = config.columns?.length ? config.columns : fields.slice(0, 5).map((f) => f.key);
  const fieldMap = new Map(fields.map((f) => [f.key, f]));

  if (data.rows.length === 0) {
    return <p className="text-sm text-muted-foreground p-2">No items found</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {columns.map((col) => (
              <th key={col} className="text-left py-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {fieldMap.get(col)?.label || col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, i) => (
            <tr key={i} className="border-b border-border/50 hover:bg-muted/50">
              {columns.map((col) => (
                <td key={col} className="py-2 px-3">
                  {formatValue(row[col], fieldMap.get(col)?.type || "string")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
