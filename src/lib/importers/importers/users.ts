/**
 * Users importer — bulk-create employee records from a CSV.
 *
 * Required: name, email
 * Optional: role, department, jobTitle, location, phone, managerEmail,
 *           hasLoginAccess
 *
 * Behavior:
 *   - Skips rows with duplicate email (already exists in DB or already
 *     created earlier in this import)
 *   - Resolves managerEmail to a manager id by looking up active users
 *     after the batch is created so managers and reports can be in the
 *     same import file
 *   - hasLoginAccess defaults to true; set to "false" / "no" / "0" to
 *     create a tracked-only employee
 *   - Login users without a password get a placeholder hash so they
 *     can't sign in until an admin sets one — this matches the existing
 *     createUser pattern for security
 *   - All rows that succeed get a logActivity entry
 *
 * Validation:
 *   - Email format checked
 *   - Role must be one of the enum values (case-insensitive)
 */

import { hash } from "bcryptjs";
import type { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import type { ImporterDefinition, ImportResult, ImportRowResult } from "../types";

const VALID_ROLES: Role[] = ["VIEWER", "CONTRIBUTOR", "DEVELOPER", "MANAGER", "ADMIN"];

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === "") return defaultValue;
  const v = value.trim().toLowerCase();
  if (["false", "no", "0", "off"].includes(v)) return false;
  if (["true", "yes", "1", "on"].includes(v)) return true;
  return defaultValue;
}

export const usersImporter: ImporterDefinition = {
  key: "users",
  name: "Employees",
  description:
    "Bulk-create user accounts from a CSV. Required columns: name, email. Optional: role, department, jobTitle, location, phone, managerEmail, hasLoginAccess.",
  module: "team",

  fields: [
    {
      key: "name",
      label: "Full name",
      required: true,
      aliases: ["full name", "fullname", "employee name"],
    },
    {
      key: "email",
      label: "Email",
      required: true,
      aliases: ["email address", "e-mail", "work email"],
    },
    {
      key: "role",
      label: "System role",
      required: false,
      description: "VIEWER, CONTRIBUTOR, DEVELOPER, MANAGER, or ADMIN. Defaults to VIEWER.",
      aliases: ["user role", "permission role"],
    },
    {
      key: "department",
      label: "Department",
      required: false,
      aliases: ["dept", "team"],
    },
    {
      key: "jobTitle",
      label: "Job title",
      required: false,
      aliases: ["title", "position"],
    },
    {
      key: "location",
      label: "Location",
      required: false,
      aliases: ["office", "city"],
    },
    {
      key: "phone",
      label: "Phone",
      required: false,
      aliases: ["phone number", "telephone", "mobile"],
    },
    {
      key: "managerEmail",
      label: "Manager email",
      required: false,
      description: "Email of the user's manager. Resolved against existing employees + others in this import.",
      aliases: ["manager", "reports to", "supervisor"],
    },
    {
      key: "hasLoginAccess",
      label: "Has login access",
      required: false,
      description: "true / false. Defaults to true. Set to false for tracked-only employees.",
      aliases: ["login", "active", "can login"],
    },
  ],

  async sampleRows() {
    // Most-recently-created active employees give a representative shape:
    // role, department, manager link, etc. Password column doesn't exist on
    // this importer; managerEmail comes from the manager relation.
    const users = await db.user.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "desc" },
      take: 3,
      include: { manager: { select: { email: true } } },
    });
    return users.map((u) => ({
      name: u.name,
      email: u.email,
      role: u.role,
      department: u.department || "",
      jobTitle: u.jobTitle || "",
      location: u.location || "",
      phone: u.phone || "",
      managerEmail: u.manager?.email || "",
      hasLoginAccess: u.hasLoginAccess ? "true" : "false",
    }));
  },

  async commit(rows, ctx) {
    const results: ImportRowResult[] = [];
    let imported = 0;
    let skipped = 0;
    let failed = 0;

    // Pre-fetch existing emails for duplicate detection
    const existingEmails = new Set(
      (
        await db.user.findMany({ select: { email: true } })
      ).map((u) => u.email.toLowerCase())
    );

    // Track emails created in this import so duplicates within the file
    // are also caught
    const createdInBatch = new Map<string, string>(); // email → user id
    /** Rows that need a manager resolved after the first pass */
    const pendingManagerLinks: { userId: string; managerEmail: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 1;
      const raw = rows[i];

      const name = (raw.name || "").trim();
      const emailRaw = (raw.email || "").trim();
      const email = emailRaw.toLowerCase();

      // Required field validation
      if (!name) {
        failed++;
        results.push({ row: rowNumber, status: "failed", message: "Missing name" });
        continue;
      }
      if (!email) {
        failed++;
        results.push({ row: rowNumber, status: "failed", message: "Missing email" });
        continue;
      }
      if (!isValidEmail(email)) {
        failed++;
        results.push({ row: rowNumber, status: "failed", message: `Invalid email: ${emailRaw}` });
        continue;
      }

      // Duplicate detection
      if (existingEmails.has(email) || createdInBatch.has(email)) {
        skipped++;
        results.push({
          row: rowNumber,
          status: "skipped",
          message: `Email already exists: ${emailRaw}`,
        });
        continue;
      }

      // Optional field parsing
      const roleRaw = (raw.role || "VIEWER").trim().toUpperCase();
      const role = VALID_ROLES.includes(roleRaw as Role) ? (roleRaw as Role) : null;
      if (!role) {
        failed++;
        results.push({
          row: rowNumber,
          status: "failed",
          message: `Invalid role "${raw.role}" — must be one of ${VALID_ROLES.join(", ")}`,
        });
        continue;
      }

      const hasLoginAccess = parseBool(raw.hasLoginAccess, true);

      // Login users get a placeholder hash they can't actually sign in with
      // until an admin sets a real password. Matches the no-login pattern in
      // src/actions/admin.ts createUser.
      const placeholder = `import-placeholder-${Date.now()}-${rowNumber}`;
      const hashedPassword = await hash(placeholder, 12);

      try {
        const newUser = await db.user.create({
          data: {
            name,
            email: emailRaw, // preserve original casing
            hashedPassword,
            role,
            hasLoginAccess,
            department: raw.department?.trim() || null,
            jobTitle: raw.jobTitle?.trim() || null,
            location: raw.location?.trim() || null,
            phone: raw.phone?.trim() || null,
          },
        });

        createdInBatch.set(email, newUser.id);
        existingEmails.add(email);
        imported++;
        results.push({ row: rowNumber, status: "imported" });

        // Defer manager resolution until everyone is created
        const managerEmail = (raw.managerEmail || "").trim().toLowerCase();
        if (managerEmail) {
          pendingManagerLinks.push({ userId: newUser.id, managerEmail });
        }

        await logActivity("imported", "user", newUser.id, ctx.triggeredBy, newUser.name);
      } catch (err) {
        failed++;
        results.push({
          row: rowNumber,
          status: "failed",
          message: err instanceof Error ? err.message : "DB error",
        });
      }
    }

    // Second pass: resolve managers. Look up by email against everyone
    // (existing + just-created). Silently skip unresolvable managers
    // rather than failing the row — the user was still created.
    if (pendingManagerLinks.length > 0) {
      const managerEmails = Array.from(
        new Set(pendingManagerLinks.map((p) => p.managerEmail))
      );
      const managers = await db.user.findMany({
        where: { email: { in: managerEmails, mode: "insensitive" } },
        select: { id: true, email: true },
      });
      const managerByEmail = new Map(
        managers.map((m) => [m.email.toLowerCase(), m.id])
      );

      for (const link of pendingManagerLinks) {
        const managerId = managerByEmail.get(link.managerEmail);
        if (managerId && managerId !== link.userId) {
          await db.user.update({
            where: { id: link.userId },
            data: { managerId },
          });
        }
      }
    }

    return { imported, skipped, failed, rows: results };
  },
};
