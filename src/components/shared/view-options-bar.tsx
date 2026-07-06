"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LayoutGrid, Table2, ListTree, type LucideIcon } from "lucide-react";

export interface ViewOption {
  value: string;
  label: string;
}

const VIEW_ICONS: Record<string, LucideIcon> = {
  cards: LayoutGrid,
  table: Table2,
  tree: ListTree,
};

/**
 * The shared "View: … · Group by: …" bar for list pages. URL-param
 * driven (`?view=` / `?groupBy=`) so views are shareable and the server
 * component decides what to render; the default option is stored as the
 * ABSENCE of the param so plain module links stay clean.
 *
 * Same navigation idiom as CertFilters: merge into the existing search
 * params and router.push, preserving whatever filters the page owns.
 */
export function ViewOptionsBar({
  view,
  viewOptions,
  groupBy,
  groupByOptions,
}: {
  /** Current view value; the FIRST entry of viewOptions is the default. */
  view?: string;
  viewOptions?: ViewOption[];
  /** Current group key, null = ungrouped (the default). */
  groupBy?: string | null;
  groupByOptions?: ViewOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const updateParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set(key, value);
      else params.delete(key);
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [router, pathname, searchParams]
  );

  const hasViews = viewOptions && viewOptions.length > 1;
  const hasGroups = groupByOptions && groupByOptions.length > 0;
  if (!hasViews && !hasGroups) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
      {hasViews && (
        <div
          className="inline-flex rounded-md border border-input bg-background p-0.5"
          role="group"
          aria-label="View"
        >
          {viewOptions.map((opt, i) => {
            const isDefault = i === 0;
            const active = view === opt.value || (isDefault && !view);
            const Icon = VIEW_ICONS[opt.value];
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => updateParam("view", isDefault ? "" : opt.value)}
                aria-pressed={active}
                className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {Icon && <Icon className="h-3.5 w-3.5" />}
                {opt.label}
              </button>
            );
          })}
        </div>
      )}

      {hasGroups && (
        <div className="flex items-center gap-1.5">
          <label
            htmlFor="group-by"
            className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
          >
            Group by
          </label>
          <select
            id="group-by"
            value={groupBy ?? ""}
            onChange={(e) => updateParam("groupBy", e.target.value)}
            className={`h-8 rounded-md border border-input bg-background px-2 pr-7 text-xs outline-none focus:ring-2 focus:ring-primary ${
              groupBy ? "text-foreground font-medium" : "text-muted-foreground"
            }`}
            aria-label="Group by"
          >
            <option value="">None</option>
            {groupByOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
