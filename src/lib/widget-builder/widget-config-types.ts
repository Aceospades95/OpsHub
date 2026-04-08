export type FieldType = "string" | "number" | "date" | "boolean" | "enum";

export type FilterOperator =
  | "equals"
  | "contains"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"
  | "notIn"
  | "isNull"
  | "isNotNull";

export type AggregationType = "count" | "sum" | "avg" | "min" | "max" | "countByField";

export type DisplayType =
  | "stat-card"
  | "counter-row"
  | "list"
  | "table"
  | "progress-bar"
  | "bar-chart"
  | "status-board";

export interface FilterConfig {
  field: string;
  operator: FilterOperator;
  value: string | number | boolean | string[];
}

export interface WidgetConfig {
  // Data
  dataSourceId: string;
  aggregation?: {
    type: AggregationType;
    field?: string;
    groupByField?: string;
  };
  filters: FilterConfig[];
  sort: { field: string; direction: "asc" | "desc" };
  limit: number;

  // Display
  displayType: DisplayType;
  columns?: string[];
  labelField?: string;
  valueField?: string;
  groupByField?: string;
  goalValue?: number;

  // Appearance
  title: string;
  icon?: string;
  color?: string;
  showHeader?: boolean;
  linkTo?: string;
}

export interface DataSourceField {
  key: string;
  label: string;
  type: FieldType;
  enumValues?: string[];
  relation?: {
    model: string;
    displayField: string;
  };
}

export interface DataSourceDefinition {
  id: string;
  label: string;
  fields: DataSourceField[];
  defaultSort: { field: string; direction: "asc" | "desc" };
  aggregations: AggregationType[];
}

export interface DisplayProps {
  config: WidgetConfig;
  data: {
    rows: Record<string, unknown>[];
    aggregate?: number | Record<string, number>;
  };
  fields: DataSourceField[];
}
