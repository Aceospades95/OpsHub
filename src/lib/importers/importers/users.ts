/**
 * Users importer — bulk-create or update employee records from a CSV.
 *
 * Required: name, email
 * Optional: role, department, jobTitle, location, phone, managerEmail,
 *           hasLoginAccess, isActive, avatar, terminationDate
 *
 * Behavior:
 *   - Email is the de-dup key, case-insensitive. If a row's email
 *     matches an existing User, the importer UPDATES that User row
 *     instead of failing. This makes the file safe to re-run after
 *     fixes to a few rows. authProvider and hashedPassword are NEVER
 *     touched on update — only the auth flow manages those.
 *   - role defaults to CONTRIBUTOR (was VIEWER) so a typical
 *     pre-provisioning of "the next 10 hires" lands them ready to
 *     contribute as soon as they're assigned to a project. VIEWER /
 *     ADMIN / etc. can still be specified explicitly.
 *   - hasLoginAccess defaults to true so admins can pre-provision
 *     blocked accounts intentionally by setting it to false in the CSV
 *     for the (rare) tracked-only employee.
 *   - On INSERT only: a placeholder bcrypt hash is written to
 *     hashedPassword so the row exists but can't sign in via
 *     credentials until an admin runs Reset Password. UPDATE rows
 *     leave any existing hashedPassword alone.
 *   - terminationDate accepts an ISO date (YYYY-MM-DD or full ISO
 *     timestamp). Invalid date strings are dropped silently with the
 *     row still importing — bad date shouldn't block a roster sync.
 *   - Resolves managerEmail to a manager id in a second pass so
 *     managers and reports can appear in the same file.
 *   - All rows that succeed get a logActivity entry.
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

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const v = value.trim();
  if (!v) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

export const usersImporter: ImporterDefinition = {
  key: "users",
  name: "Employees",
  description:
    "Bulk-create or update user accounts from a CSV. Required columns: name, email. Email is the match key — re-running the same file with edits updates existing rows. Optional: role, department, jobTitle, location, phone, managerEmail, hasLoginAccess, isActive, avatar, terminationDate.",
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
      description: "VIEWER, CONTRIBUTOR, DEVELOPER, MANAGER, or ADMIN. Defaults to CONTRIBUTOR.",
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
    {
      key: "isActive",
      label: "Is active",
      required: false,
      description: "true / false. Defaults to true. Set to false to import a former employee whose account is retained for audit history.",
      aliases: ["active", "status"],
    },
    {
      key: "avatar",
      label: "Avatar URL",
      required: false,
      description: "Optional URL to a profile photo. Leave blank to use initials.",
      aliases: ["photo", "picture", "avatar url"],
    },
    {
      key: "terminationDate",
      label: "Termination date",
      required: false,
      description: "ISO date (YYYY-MM-DD). Used by the offboarding workflow trigger; null means active employee.",
      aliases: ["termination date", "end date", "last day"],
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
      isActive: u.isActive ? "true" : "false",
      avatar: u.avatar || "",
      terminationDate: u.terminationDate
        ? u.terminationDate.toISOString().slice(0, 10)
        : "",
    }));
  },

  async commit(rows, ctx) {
    const results: ImportRowResult[] = [];
    let imported = 0;
    let skipped = 0;
    let failed = 0;

    // Pre-fetch existing users keyed by lowercased email so duplicate
    // detection AND update routing share one read. We pull the id so
    // we can update without a second findUnique per row.
    const existingByEmail = new Map<string, { id: string }>(
      (
        await db.user.findMany({ select: { id: true, email: true } })
      ).map((u) => [u.email.toLowerCase(), { id: u.id }])
    );

    /** Track emails seen earlier in this same file so we don't process
     *  the same email twice (the first occurrence wins; subsequent
     *  rows are skipped with a "duplicate row in file" message). */
    const seenInBatch = new Set<string>();
    /** Rows that need a manager resolved after the first pass. */
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
      if (seenInBatch.has(email)) {
        skipped++;
        results.push({
          row: rowNumber,
          status: "skipped",
          message: `Duplicate row in file: ${emailRaw}`,
        });
        continue;
      }
      seenInBatch.add(email);

      // Optional field parsing — note role default flipped from VIEWER
      // to CONTRIBUTOR per the pre-provisioning workflow.
      const roleRaw = (raw.role || "CONTRIBUTOR").trim().toUpperCase();
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
      const isActive = parseBool(raw.isActive, true);
      const avatar = raw.avatar?.trim() || null;
      const terminationDate = parseDate(raw.terminationDate);
      const department = raw.department?.trim() || null;
      const jobTitle = raw.jobTitle?.trim() || null;
      const location = raw.location?.trim() || null;
      const phone = raw.phone?.trim() || null;

      const existing = existingByEmail.get(email);

      try {
        let userId: string;
        let actionLabel: "imported" | "updated";
        let displayName: string;

        if (existing) {
          // UPDATE path — never touch hashedPassword or authProvider
          // (those are owned by the auth flow, not the importer).
          // Email casing is preserved by NOT writing email here.
          const updated = await db.user.update({
            where: { id: existing.id },
            data: {
              name,
              role,
              hasLoginAccess,
              isActive,
              avatar,
              department,
              jobTitle,
              location,
              phone,
              terminationDate,
            },
            select: { id: true, name: true },
          });
          userId = updated.id;
          actionLabel = "updated";
          displayName = updated.name;
        } else {
          // INSERT path — placeholder hashedPassword so the row exists
          // but can't sign in via credentials until an admin runs Reset
          // Password. authProvider stays at its default ("credentials")
          // because we leave it unset.
          const placeholder = `import-placeholder-${Date.now()}-${rowNumber}`;
          const hashedPassword = await hash(placeholder, 12);
          const created = await db.user.create({
            data: {
              name,
              email: emailRaw, // preserve original casing on insert
              hashedPassword,
              role,
              hasLoginAccess,
              isActive,
              avatar,
              department,
              jobTitle,
              location,
              phone,
              terminationDate,
            },
            select: { id: true, name: true },
          });
          userId = created.id;
          actionLabel = "imported";
          displayName = created.name;
          existingByEmail.set(email, { id: userId });
        }

        imported++;
        results.push({
          row: rowNumber,
          status: "imported",
          message: actionLabel === "updated" ? "Updated existing user" : undefined,
        });

        // Defer manager resolution until everyone is created/updated
        const managerEmail = (raw.managerEmail || "").trim().toLowerCase();
        if (managerEmail) {
          pendingManagerLinks.push({ userId, managerEmail });
        }

        await logActivity(actionLabel, "user", userId, ctx.triggeredBy, displayName);
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
    // rather than failing the row — the user was still created/updated.
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
