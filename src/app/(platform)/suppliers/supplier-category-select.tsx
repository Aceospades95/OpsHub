"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

/** Sentinel option value for "declare a new category". */
const NEW_CATEGORY = "__new__";

const DEFAULT_CATEGORIES = [
  "auto_repair",
  "decals",
  "alarm_security",
  "maintenance",
  "it_services",
  "office_supplies",
  "other",
];

function labelOf(category: string): string {
  return category.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

/**
 * Category picker for the supplier forms: existing categories (defaults ∪
 * whatever is already in the database, passed from the server) plus an
 * "Add new category…" option that reveals a free-text input. The server
 * action normalizes the new name to snake_case so it groups consistently
 * and appears in this picker from then on.
 */
export function SupplierCategorySelect({
  categories,
  defaultValue,
}: {
  /** Distinct categories already in the database. */
  categories: string[];
  defaultValue?: string;
}) {
  const [value, setValue] = useState(defaultValue ?? "");
  const isNew = value === NEW_CATEGORY;

  const known = Array.from(new Set([...DEFAULT_CATEGORIES, ...categories])).sort((a, b) =>
    labelOf(a).localeCompare(labelOf(b))
  );

  return (
    <>
      <Select
        name="category"
        label="Category"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        options={[
          ...known.map((c) => ({ label: labelOf(c), value: c })),
          { label: "+ Add new category…", value: NEW_CATEGORY },
        ]}
        placeholder="Select category"
        required
      />
      {isNew && (
        <Input
          name="newCategory"
          label="New category name"
          placeholder='e.g. "Fleet Maintenance"'
          required
          autoFocus
        />
      )}
    </>
  );
}
