"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

interface ProjectFiltersProps {
  currentSort?: string;
}

export function ProjectFilters({ currentSort }: ProjectFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const updateFilter = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      router.push(`/projects?${params.toString()}`);
    },
    [router, searchParams]
  );

  return (
    <select
      value={currentSort || ""}
      onChange={(e) => updateFilter("sort", e.target.value)}
      className={`h-8 rounded border border-input bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-primary ${
        currentSort ? "text-foreground font-medium" : "text-muted-foreground"
      }`}
      aria-label="Sort"
    >
      <option value="">Recently Updated</option>
      <option value="name-asc">Name A-Z</option>
      <option value="name-desc">Name Z-A</option>
      <option value="members">Most Members</option>
    </select>
  );
}
