import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

import { ENTITY_REGISTRY } from "@/lib/reports/custom/entities";
import { ReportBuilder } from "../report-builder";
import type { EntityCatalogEntry } from "../shared-types";

export default async function NewCustomReportPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/dashboard");

  const catalog = projectCatalog();
  const first = catalog[0];

  return (
    <ReportBuilder
      reportId={null}
      catalog={catalog}
      initial={{
        name: "",
        description: "",
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
