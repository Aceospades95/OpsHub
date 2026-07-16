import { requireAuth } from "@/lib/permissions";
import { redirect } from "next/navigation";

import { db } from "@/lib/db";
import { ENTITY_REGISTRY } from "@/lib/reports/custom/entities";
import { ReportBuilder } from "../report-builder";
import type { EntityCatalogEntry } from "../shared-types";

export default async function NewCustomReportPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string }>;
}) {
  const user = await requireAuth();
  if (user.role !== "ADMIN") redirect("/dashboard");

  const catalog = projectCatalog();

  // "Duplicate as custom report" on system report pages deep-links here
  // with ?entity=<CustomReportEntity> so the builder starts on the same
  // table. Unknown/absent values fall back to the first catalog entry.
  const { entity } = await searchParams;
  const first =
    (entity && catalog.find((c) => c.entity === entity)) || catalog[0];

  // Pull existing category labels so the autocomplete suggests them.
  // Distinct query feeds a <datalist> in the builder UI.
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
      reportId={null}
      catalog={catalog}
      existingCategories={existingCategories}
      initial={{
        name: "",
        description: "",
        category: "",
        entityType: first.entity,
        columns: first.defaultColumns,
        filters: [],
        sortBy: first.defaultSort ?? "",
        limit: "",
        isActive: true,
      }}
    />
  );
}

/** Project the entity registry onto the JSON-friendly shape the
 *  client builder expects. Kept inline because `entities.ts` itself
 *  carries server-only Prisma calls; we don't want to import it from
 *  the client bundle. */
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
