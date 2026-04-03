"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

interface ClientFiltersProps {
  currentStatus?: string;
  currentSort?: string;
  resultCount: number;
}

export function ClientFilters({
  currentStatus,
  currentSort,
  resultCount,
}: ClientFiltersProps) {
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
      router.push(`/clients?${params.toString()}`);
    },
    [router, searchParams]
  );

  const clearAll = () => {
    router.push("/clients");
  };

  const hasFilters = currentStatus || currentSort;

  return (
    <div className="flex flex-wrap items-center gap-3 mb-6">
      {/* Quick status filters */}
      <div className="flex items-center gap-1.5">
        <QuickButton
          label="All"
          active={!currentStatus}
          onClick={() => updateFilter("status", "")}
        />
        <QuickButton
          label="Active"
          active={currentStatus === "ACTIVE"}
          onClick={() => updateFilter("status", currentStatus === "ACTIVE" ? "" : "ACTIVE")}
        />
        <QuickButton
          label="Prospect"
          active={currentStatus === "PROSPECT"}
          onClick={() => updateFilter("status", currentStatus === "PROSPECT" ? "" : "PROSPECT")}
        />
        <QuickButton
          label="Inactive"
          active={currentStatus === "INACTIVE"}
          onClick={() => updateFilter("status", currentStatus === "INACTIVE" ? "" : "INACTIVE")}
        />
      </div>

      <span className="text-border">|</span>

      {/* Sort dropdown */}
      <FilterSelect
        value={currentSort || ""}
        onChange={(v) => updateFilter("sort", v)}
        placeholder="Sort"
      >
        <option value="">Recently Updated</option>
        <option value="name-asc">Name A-Z</option>
        <option value="name-desc">Name Z-A</option>
        <option value="projects">Most Projects</option>
      </FilterSelect>

      <span className="text-xs text-muted-foreground">
        {resultCount} {resultCount === 1 ? "client" : "clients"}
      </span>

      {hasFilters && (
        <button
          onClick={clearAll}
          className="text-xs text-primary hover:underline"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}

function QuickButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
        active
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-muted-foreground hover:bg-border"
      }`}
    >
      {label}
    </button>
  );
}

function FilterSelect({
  value,
  onChange,
  placeholder,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`h-8 rounded border border-input bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-primary ${
        value ? "text-foreground font-medium" : "text-muted-foreground"
      }`}
      aria-label={placeholder}
    >
      {children}
    </select>
  );
}
