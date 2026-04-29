"use server";

import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { requireAuth } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { CustomReportEntity, Role } from "@prisma/client";

import { getEntityDef } from "@/lib/reports/custom/entities";
import { runCustomReportFromRow } from "@/lib/reports/custom/runtime";

function requireAdmin(role: Role): { error: string } | null {
  if (role !== "ADMIN") {
    return { error: "Admin access required" };
  }
  return null;
}

const entitySchema = z.enum([
  "USER",
  "PROJECT",
  "CLIENT",
  "QUOTE",
  "TASK",
  "CONTRACT",
  "CERTIFICATION",
  "ASSIGNMENT",
  "SUBCONTRACTOR",
  "PARTNERSHIP",
]);

const filterSchema = z.object({
  field: z.string().min(1),
  op: z.enum([
    "equals",
    "contains",
    "in",
    "gt",
    "gte",
    "lt",
    "lte",
    "isNull",
    "isNotNull",
  ]),
  value: z.unknown().optional(),
});

const upsertSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().nullish(),
  category: z.string().nullish(),
  entityType: entitySchema,
  columns: z.array(z.string()),
  filters: z.array(filterSchema),
  sortBy: z.string().nullish(),
  limit: z.number().int().positive().nullish(),
  isActive: z.boolean().optional(),
});

export type CustomReportUpsertInput = z.infer<typeof upsertSchema>;

export async function createCustomReport(input: CustomReportUpsertInput) {
  const user = await requireAuth();
  const gate = requireAdmin(user.role);
  if (gate) return gate;

  const parsed = upsertSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: "Invalid input",
      fieldErrors: parsed.error.flatten().fieldErrors,
    } as const;
  }

  // Sanity: every selected column has to exist in the entity
  // registry. Drops unknown columns silently rather than failing —
  // the registry is the source of truth.
  const def = getEntityDef(parsed.data.entityType as CustomReportEntity);
  const validKeys = new Set(def.columns.map((c) => c.key));
  const cleanColumns = parsed.data.columns.filter((k) => validKeys.has(k));

  const created = await db.customReport.create({
    data: {
      name: parsed.data.name,
      description: parsed.data.description?.trim() || null,
      category: parsed.data.category?.trim() || null,
      entityType: parsed.data.entityType as CustomReportEntity,
      columns: JSON.stringify(
        cleanColumns.length > 0 ? cleanColumns : def.defaultColumns
      ),
      filters: JSON.stringify(parsed.data.filters ?? []),
      sortBy: parsed.data.sortBy?.trim() || null,
      limit: parsed.data.limit ?? null,
      isActive: parsed.data.isActive ?? true,
      createdById: user.id,
    },
  });

  await logActivity("created", "custom-report", created.id, user.id, created.name);
  revalidatePath("/admin/reports");
  return { success: true, id: created.id } as const;
}

export async function updateCustomReport(
  input: { id: string } & CustomReportUpsertInput
) {
  const user = await requireAuth();
  const gate = requireAdmin(user.role);
  if (gate) return gate;

  const parsed = upsertSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: "Invalid input",
      fieldErrors: parsed.error.flatten().fieldErrors,
    } as const;
  }

  const def = getEntityDef(parsed.data.entityType as CustomReportEntity);
  const validKeys = new Set(def.columns.map((c) => c.key));
  const cleanColumns = parsed.data.columns.filter((k) => validKeys.has(k));

  await db.customReport.update({
    where: { id: input.id },
    data: {
      name: parsed.data.name,
      description: parsed.data.description?.trim() || null,
      category: parsed.data.category?.trim() || null,
      entityType: parsed.data.entityType as CustomReportEntity,
      columns: JSON.stringify(
        cleanColumns.length > 0 ? cleanColumns : def.defaultColumns
      ),
      filters: JSON.stringify(parsed.data.filters ?? []),
      sortBy: parsed.data.sortBy?.trim() || null,
      limit: parsed.data.limit ?? null,
      isActive: parsed.data.isActive ?? true,
    },
  });
  await logActivity("updated", "custom-report", input.id, user.id, parsed.data.name);
  revalidatePath("/admin/reports");
  revalidatePath(`/admin/reports/custom/${input.id}/edit`);
  return { success: true } as const;
}

export async function deleteCustomReport(id: string) {
  const user = await requireAuth();
  const gate = requireAdmin(user.role);
  if (gate) return gate;
  const existing = await db.customReport.findUnique({
    where: { id },
    select: { name: true },
  });
  if (!existing) return { error: "Report not found" } as const;
  await db.customReport.delete({ where: { id } });
  await logActivity("deleted", "custom-report", id, user.id, existing.name);
  revalidatePath("/admin/reports");
  return { success: true } as const;
}

/**
 * Preview a (possibly unsaved) report by running it against current
 * data. The builder UI calls this on every relevant change so the
 * admin sees a live result table without having to save first.
 */
export async function previewCustomReport(input: CustomReportUpsertInput) {
  const user = await requireAuth();
  const gate = requireAdmin(user.role);
  if (gate) return gate;

  const parsed = upsertSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Invalid input" } as const;
  }
  const def = getEntityDef(parsed.data.entityType as CustomReportEntity);
  const validKeys = new Set(def.columns.map((c) => c.key));
  const cleanColumns = parsed.data.columns.filter((k) => validKeys.has(k));

  // Run via a transient row — no DB writes for preview.
  try {
    const output = await runCustomReportFromRow({
      id: "preview",
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      category: parsed.data.category?.trim() || null,
      entityType: parsed.data.entityType as CustomReportEntity,
      columns: JSON.stringify(
        cleanColumns.length > 0 ? cleanColumns : def.defaultColumns
      ),
      filters: JSON.stringify(parsed.data.filters ?? []),
      sortBy: parsed.data.sortBy?.trim() || null,
      // Cap preview at 50 rows even when the saved limit is higher,
      // so the live preview doesn't drag the editor down on large
      // tables.
      limit: Math.min(parsed.data.limit ?? def.defaultLimit, 50),
      isActive: true,
      createdById: user.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return {
      success: true,
      output: {
        summary: output.summary,
        columns: output.columns.map((c) => ({
          key: c.key,
          label: c.label,
          align: c.align,
        })),
        // Apply per-column formatters here so the client doesn't have
        // to re-resolve them; we serialize across the boundary. Rows
        // become string-keyed for stable JSON.
        rows: output.rows.map((row) => {
          const out: Record<string, string> = {};
          for (const c of output.columns) {
            const raw = row[c.key];
            out[c.key] = c.format
              ? c.format(raw)
              : raw == null
                ? "—"
                : String(raw);
          }
          return out;
        }),
      },
    } as const;
  } catch (err) {
    // Don't surface the raw error message — it can include Prisma SQL,
    // table names, and constraint details. Log server-side so an admin
    // can debug, return a generic message to the client.
    log.error("custom-reports.preview", "Preview failed", err);
    return {
      error:
        "Preview failed. Check server logs for details, or simplify the filters and try again.",
    } as const;
  }
}
