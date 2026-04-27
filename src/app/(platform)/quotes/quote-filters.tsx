"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

interface QuoteFiltersProps {
  currentStatus?: string;
  currentSearch?: string;
  resultCount: number;
}

const STATUS_TABS: { label: string; value: string }[] = [
  { label: "All", value: "" },
  { label: "Drafts", value: "DRAFT" },
  { label: "Sent", value: "SENT" },
  { label: "Accepted", value: "ACCEPTED" },
  { label: "Rejected", value: "REJECTED" },
  { label: "Expired", value: "EXPIRED" },
];

export function QuoteFilters({
  currentStatus,
  currentSearch,
  resultCount,
}: QuoteFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(currentSearch ?? "");

  const update = useCallback(
    (next: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(next)) {
        if (v) params.set(k, v);
        else params.delete(k);
      }
      router.push(`/quotes?${params.toString()}`);
    },
    [router, searchParams]
  );

  // Debounce search input — push the new query 300ms after the last keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      if ((currentSearch ?? "") !== search) update({ q: search });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const hasFilters = currentStatus || currentSearch;

  return (
    <div className="flex flex-wrap items-center gap-3 mb-4">
      <div className="flex items-center gap-1.5 flex-wrap">
        {STATUS_TABS.map((tab) => {
          const active =
            (tab.value === "" && !currentStatus) || tab.value === currentStatus;
          return (
            <button
              key={tab.value || "all"}
              onClick={() => update({ status: tab.value })}
              className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-border"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <span className="text-border hidden sm:inline">|</span>

      <input
        type="search"
        placeholder="Search title, number, client…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="h-8 w-64 max-w-full rounded border border-input bg-background px-3 text-xs outline-none focus:ring-2 focus:ring-primary"
      />

      <span className="text-xs text-muted-foreground">
        {resultCount} {resultCount === 1 ? "quote" : "quotes"}
      </span>

      {hasFilters && (
        <button
          onClick={() => router.push("/quotes")}
          className="text-xs text-primary hover:underline"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
