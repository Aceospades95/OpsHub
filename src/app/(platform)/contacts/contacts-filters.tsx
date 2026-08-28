"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { pluralize } from "@/lib/pluralize";

/**
 * Search box + "show former" toggle for the contacts list. URL-param
 * driven (like QuoteFilters) so results are shareable and the server
 * page does the filtering.
 */
export function ContactsFilters({
  currentSearch,
  showFormer,
  resultCount,
}: {
  currentSearch: string;
  showFormer: boolean;
  resultCount: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(currentSearch);

  const update = useCallback(
    (next: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(next)) {
        if (v) params.set(k, v);
        else params.delete(k);
      }
      const qs = params.toString();
      router.push(qs ? `/contacts?${qs}` : "/contacts");
    },
    [router, searchParams]
  );

  // Debounced search push.
  useEffect(() => {
    const t = setTimeout(() => {
      if (currentSearch !== search.trim()) update({ q: search.trim() });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  return (
    <div className="flex flex-wrap items-center gap-3 mb-4">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email, organization…"
          aria-label="Search contacts"
          className="h-8 w-64 rounded border border-input bg-background pl-8 pr-2 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
        <input
          type="checkbox"
          checked={showFormer}
          onChange={(e) => update({ former: e.target.checked ? "1" : "" })}
          className="rounded"
        />
        Show former contacts
      </label>

      <span className="ml-auto text-xs text-muted-foreground">
        {pluralize(resultCount, "contact")}
      </span>
    </div>
  );
}
