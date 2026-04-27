/**
 * Server → client serialization types for the custom-report builder.
 *
 * The entity registry on the server contains formatter functions that
 * can't cross the React server/client boundary. We project it down
 * to a JSON-friendly shape here and pass that to the builder UI.
 */

import type { CustomReportEntity } from "@prisma/client";
import type { FilterOperator, FieldType } from "@/lib/reports/custom/entities";

export interface CatalogColumn {
  key: string;
  label: string;
  type: FieldType;
  enumValues?: string[];
}

export interface CatalogFilter {
  key: string;
  label: string;
  type: FieldType;
  operators: FilterOperator[];
  enumValues?: string[];
}

export interface EntityCatalogEntry {
  entity: CustomReportEntity;
  label: string;
  description: string;
  columns: CatalogColumn[];
  filters: CatalogFilter[];
  defaultColumns: string[];
  defaultSort?: string;
  defaultLimit: number;
}

export interface SerializedFilter {
  field: string;
  op: FilterOperator;
  value: unknown;
}

export interface PreviewOutput {
  summary: string;
  columns: { key: string; label: string; align?: "left" | "right" | "center" }[];
  rows: Record<string, string>[];
}
