"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback } from "react";
import Link from "next/link";
import type { JurisdictionLevel, CertEngagementType } from "@prisma/client";

interface Props {
  jurisdictionLevels: JurisdictionLevel[];
  engagementTypes: CertEngagementType[];
  jurisdictionFilter: JurisdictionLevel | null;
  engagementFilter: CertEngagementType | null;
  hasAnyFilter: boolean;
}

export function CertFilters({
  jurisdictionLevels,
  engagementTypes,
  jurisdictionFilter,
  engagementFilter,
  hasAnyFilter,
}: Props) {
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

  const selectClass = (active: boolean) =>
    `h-8 rounded-md border border-input bg-background px-2 pr-7 text-xs outline-none focus:ring-2 focus:ring-primary ${
      active ? "text-foreground font-medium" : "text-muted-foreground"
    }`;

  return (
    <div className="mb-6 flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1.5">
        <label
          htmlFor="filter-jurisdiction"
          className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Jurisdiction
        </label>
        <select
          id="filter-jurisdiction"
          value={jurisdictionFilter ?? ""}
          onChange={(e) => updateParam("jurisdiction", e.target.value)}
          className={selectClass(jurisdictionFilter !== null)}
          aria-label="Filter by jurisdiction"
        >
          <option value="">All</option>
          {jurisdictionLevels.map((level) => (
            <option key={level} value={level}>
              {level.charAt(0) + level.slice(1).toLowerCase()}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-1.5">
        <label
          htmlFor="filter-engagement"
          className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Type
        </label>
        <select
          id="filter-engagement"
          value={engagementFilter ?? ""}
          onChange={(e) => updateParam("engagement", e.target.value)}
          className={selectClass(engagementFilter !== null)}
          aria-label="Filter by engagement type"
        >
          <option value="">All</option>
          {engagementTypes.map((t) => (
            <option key={t} value={t}>
              {t.charAt(0) + t.slice(1).toLowerCase()}
            </option>
          ))}
        </select>
      </div>

      {hasAnyFilter && (
        <Link
          href="/certifications"
          className="ml-1 text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
        >
          Clear filters
        </Link>
      )}
    </div>
  );
}
