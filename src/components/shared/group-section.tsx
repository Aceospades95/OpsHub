import type { ReactNode } from "react";

/**
 * Collapsible section wrapper for grouped list/table views. Native
 * <details> so grouping costs zero client JS — sections start open and
 * the header row shows the group label + count consistently everywhere.
 */
export function GroupSection({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <details open className="group/section mb-6 last:mb-0">
      <summary className="flex cursor-pointer select-none items-center gap-2 mb-3 list-none [&::-webkit-details-marker]:hidden">
        <span className="text-muted-foreground transition-transform group-open/section:rotate-90">
          ▸
        </span>
        <h2 className="text-sm font-semibold text-foreground">{label}</h2>
        <span className="text-xs text-muted-foreground">({count})</span>
        <span className="flex-1 border-t border-border ml-2" />
      </summary>
      {children}
    </details>
  );
}
