"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

interface ClientOption {
  id: string;
  name: string;
}

interface QuoteFiltersProps {
  clients: ClientOption[];
  currentClientId?: string;
  currentSort?: string;
  currentSearch?: string;
  resultCount: number;
}

export function QuoteFilters({
  clients,
  currentClientId,
  currentSort,
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

  // Debounced search push.
  useEffect(() => {
    const t = setTimeout(() => {
      if ((currentSearch ?? "") !== search) update({ q: search });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const hasFilters = currentClientId || currentSearch || currentSort;

  return (
    <div className="flex flex-wrap items-center gap-3 mb-4">
      <select
        value={currentClientId ?? ""}
        onChange={(e) => update({ clientId: e.target.value })}
        className="h-8 rounded border border-input bg-background px-2 text-xs"
        aria-label="Filter by client"
      >
        <option value="">All clients</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      <select
        value={currentSort ?? "updated"}
        onChange={(e) => update({ sort: e.target.value })}
        className="h-8 rounded border border-input bg-background px-2 text-xs"
        aria-label="Sort"
      >
        <option value="updated">Recently updated</option>
        <option value="created">Recently created</option>
        <option value="client">Client (A–Z)</option>
        <option value="project">Project (A–Z)</option>
        <option value="number">Quote number</option>
        <option value="total">Highest total</option>
      </select>

      <span className="text-border hidden sm:inline">|</span>

      <input
        type="search"
        placeholder="Search title, number, client, project…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="h-8 w-72 max-w-full rounded border border-input bg-background px-3 text-xs outline-none focus:ring-2 focus:ring-primary"
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
