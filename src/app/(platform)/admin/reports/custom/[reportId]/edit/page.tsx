import { requireAuth } from "@/lib/permissions";
import { notFound, redirect } from "next/navigation";

import { db } from "@/lib/db";
import { ENTITY_REGISTRY } from "@/lib/reports/custom/entities";
import { ReportBuilder } from "../../report-builder";
import type {
  EntityCatalogEntry,
  SerializedFilter,
} from "../../shared-types";

interface Props {
  params: Promise<{ reportId: string }>;
}

export default async function EditCustomReportPage({ params }: Props) {
  const { reportId } = await params;
  const user = await requireAuth();
  if (user.role !== "ADMIN") redirect("/dashboard");

  const report = await db.customReport.findUnique({
    where: { id: reportId },
  });
  if (!report) notFound();

  let savedColumns: string[] = [];
  let savedFilters: SerializedFilter[] = [];
  try {
    savedColumns = JSON.parse(report.columns) as string[];
  } catch {
    savedColumns = [];
  }
  try {
    savedFilters = JSON.parse(report.filters) as SerializedFilter[];
  } catch {
    savedFilters = [];
  }

  const catalog = projectCatalog();

  // Fetch every distinct category so the autocomplete suggests them.
  const existing = await db.customReport.findMany({
    where: { category: { not: null } },
    select: { category: true },
    distinct: ["category"],
  });
  const existingCategories = existing
    .map((r) => r.category)
    .filter((c): c is string => Boolean(c))
    .sort();

  return (
    <ReportBuilder
      reportId={report.id}
      catalog={catalog}
      existingCategories={existingCategories}
      initial={{
        name: report.name,
        description: report.description ?? "",
        category: report.category ?? "",
        entityType: report.entityType,
        columns: savedColumns,
        filters: savedFilters,
        sortBy: report.sortBy ?? "",
        limit: report.limit != null ? String(report.limit) : "",
        isActive: report.isActive,
      }}
    />
  );
}

function projectCatalog(): EntityCatalogEntry[] {
  return (Object.keys(ENTITY_REGISTRY) as (keyof typeof ENTITY_REGISTRY)[]).map(
    (entity) => {
      const def = ENTITY_REGISTRY[entity];
      return {
        entity,
        label: def.label,
        description: def.description,
        defaultColumns: def.defaultColumns,
        defaultSort: def.defaultSort,
        defaultLimit: def.defaultLimit,
        columns: def.columns.map((c) => ({
          key: c.key,
          label: c.label,
          type: c.type,
          enumValues: c.enumValues,
        })),
        filters: def.filters.map((f) => ({
          key: f.key,
          label: f.label,
          type: f.type,
          operators: f.operators,
          enumValues: f.enumValues,
        })),
      };
    }
  );
}
