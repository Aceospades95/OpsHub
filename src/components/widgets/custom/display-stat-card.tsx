import type { DisplayProps } from "@/lib/widget-builder/widget-config-types";

export function DisplayStatCard({ config, data }: DisplayProps) {
  const value = typeof data.aggregate === "number" ? data.aggregate : 0;
  const label = config.title || "Count";

  return (
    <div className="flex flex-col items-center justify-center h-full py-4">
      <div className="text-4xl font-bold text-foreground">{value.toLocaleString()}</div>
      <div className="text-sm text-muted-foreground mt-1">{label}</div>
      {config.linkTo && (
        <a href={config.linkTo} className="text-xs text-primary hover:underline mt-2">View all</a>
      )}
    </div>
  );
}
