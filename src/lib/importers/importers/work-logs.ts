/**
 * Work-logs importer — migrate the daily-log spreadsheet (or bulk-fix
 * history) into WorkLog rows.
 *
 * Required: email (resolved to an existing user — hard fail naming the
 * email otherwise), workDate (YYYY-MM-DD or M/D/YYYY), hours (0–24).
 * Optional: sites (tickets/sites free text), notes.
 *
 * Match key: (user, workDate) — the same unique key the submit action
 * upserts on, so all four modes work. Duplicates WITHIN the file keep
 * the LAST row: the sheet this replaces treated a later same-day entry
 * as the corrected resubmission, and the importer preserves those
 * semantics (earlier rows are reported as skipped, never summed).
 *
 * Dates are calendar dates stored at UTC midnight (lib/dates). Loose
 * `new Date(...)` parsing is deliberately NOT used — it reads
 * "7/6/2026" in the server's local timezone and can shift the day.
 */

import { db } from "@/lib/db";
import { parseCalendarDateString, toCalendarDateString } from "@/lib/dates";
import type { ImporterDefinition, ImportRowResult } from "../types";
import {
  applyMode,
  buildResult,
  logImportActivity,
  mergeFillBlanks,
  skipExistsMessage,
  skipNoMatchMessage,
  warnList,
} from "../helpers";

/** Strict calendar-date parse: YYYY-MM-DD first, then sheet-style M/D/YYYY. */
export function parseWorkDate(raw: string): Date | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const iso = parseCalendarDateString(trimmed);
  if (iso) return iso;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (us) {
    const month = Number(us[1]);
    const day = Number(us[2]);
    const year = Number(us[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    // Round-trip so 2/30 doesn't roll over into March.
    if (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    ) {
      return date;
    }
  }
  return null;
}

function parseHours(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export const workLogsImporter: ImporterDefinition = {
  key: "work-logs",
  name: "Work logs",
  description:
    "Bulk-create or update daily technician work logs. Required: employee email, work date, hours (0–24). Optional: tickets/sites and notes. One log per person per day; a later duplicate row in the file wins.",
  module: "work-logs",
  supportsUpsert: true,
  upsertKeyDescription:
    "Matched by employee email + work date (one log per person per day). Duplicate rows in the same file keep the LAST occurrence — later lines count as corrected resubmissions.",

  fields: [
    {
      key: "email",
      label: "Employee email",
      required: true,
      description: "Must match an existing user's email. Rows with unknown emails fail.",
      aliases: ["user email", "employee", "e-mail", "email address"],
    },
    {
      key: "workDate",
      label: "Work date",
      required: true,
      description: "The calendar day being reported — YYYY-MM-DD (or M/D/YYYY).",
      aliases: ["date", "day", "work day"],
    },
    {
      key: "hours",
      label: "Hours",
      required: true,
      description: "Hours worked that day, 0–24 (decimals OK, e.g. 7.5).",
      aliases: ["hours worked", "hrs", "time"],
    },
    {
      key: "sites",
      label: "Tickets / sites",
      required: false,
      description: 'Free text, e.g. "PHLF014 Service call".',
      aliases: ["tickets", "site", "tickets/sites", "ticket"],
    },
    { key: "notes", label: "Notes", required: false, aliases: ["comments", "description"] },
  ],

  async sampleRows() {
    const logs = await db.workLog.findMany({
      orderBy: { workDate: "desc" },
      take: 3,
      include: { user: { select: { email: true } } },
    });
    return logs.map((l) => ({
      email: l.user.email,
      workDate: toCalendarDateString(l.workDate),
      hours: String(l.hours),
      sites: l.sites || "",
      notes: l.notes || "",
    }));
  },

  async exportRows() {
    const logs = await db.workLog.findMany({
      orderBy: [{ workDate: "desc" }, { user: { name: "asc" } }],
      include: { user: { select: { email: true } } },
    });
    return logs.map((l) => ({
      email: l.user.email,
      workDate: toCalendarDateString(l.workDate),
      hours: String(l.hours),
      sites: l.sites || "",
      notes: l.notes || "",
    }));
  },

  async commit(rows, ctx) {
    const db = ctx.db; // ALL commit reads/writes go through ctx.db
    const results: ImportRowResult[] = [];

    // Resolve against EVERY user (not just active) — importing last
    // quarter's sheet legitimately references people who've since left.
    const users = await db.user.findMany({
      select: { id: true, email: true, name: true, isActive: true },
    });
    const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));

    // In-file duplicates: LAST row per (email, workDate) wins.
    const lastRowIndexByKey = new Map<string, number>();
    rows.forEach((raw, index) => {
      const email = (raw.email || "").trim().toLowerCase();
      const workDate = parseWorkDate(raw.workDate || "");
      if (!email || !workDate) return; // invalid rows fail on their own below
      lastRowIndexByKey.set(`${email}|${workDate.toISOString()}`, index);
    });

    const today = new Date();

    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 1;
      const raw = rows[i];
      const warnings: string[] = [];

      const emailRaw = (raw.email || "").trim();
      if (!emailRaw) {
        results.push({ row: rowNumber, status: "failed", message: "Missing email" });
        continue;
      }
      const user = userByEmail.get(emailRaw.toLowerCase());
      if (!user) {
        results.push({
          row: rowNumber,
          status: "failed",
          message: `No user with email "${emailRaw}" — add them on the Team page first`,
        });
        continue;
      }

      const workDate = parseWorkDate(raw.workDate || "");
      if (!workDate) {
        results.push({
          row: rowNumber,
          status: "failed",
          message: `Invalid work date "${(raw.workDate || "").trim()}" — expected YYYY-MM-DD (or M/D/YYYY)`,
        });
        continue;
      }
      const dateStr = toCalendarDateString(workDate);

      const dupKey = `${emailRaw.toLowerCase()}|${workDate.toISOString()}`;
      const lastIndex = lastRowIndexByKey.get(dupKey);
      if (lastIndex !== undefined && lastIndex !== i) {
        results.push({
          row: rowNumber,
          status: "skipped",
          message: `Duplicate of row ${lastIndex + 1} (${emailRaw} on ${dateStr}) — the last row in the file wins (corrected resubmission)`,
        });
        continue;
      }

      const hours = parseHours(raw.hours || "");
      if (hours === null || hours < 0 || hours > 24) {
        results.push({
          row: rowNumber,
          status: "failed",
          message: `Invalid hours "${(raw.hours || "").trim()}" — must be a number between 0 and 24`,
        });
        continue;
      }

      if (!user.isActive) {
        warnings.push(`${user.name} is inactive — imported as a historical record`);
      }
      if (workDate.getTime() > today.getTime()) {
        warnings.push(`Work date ${dateStr} is in the future`);
      }

      const data = {
        hours,
        sites: (raw.sites || "").trim() || null,
        notes: (raw.notes || "").trim() || null,
      };
      const label = `${user.name} ${dateStr}`;

      try {
        const existing = await db.workLog.findUnique({
          where: { userId_workDate: { userId: user.id, workDate } },
        });
        const action = applyMode(existing, ctx.mode);

        if (action === "update" && existing) {
          const updateData =
            ctx.mode === "fill-blanks" ? mergeFillBlanks(existing, data) : data;
          await db.workLog.update({ where: { id: existing.id }, data: updateData });
          results.push({ row: rowNumber, status: "updated", warnings: warnList(warnings) });
          await logImportActivity(ctx, "imported", "work-log", existing.id, `${label} (updated, ${hours}h)`);
        } else if (action === "skip") {
          const keyLabel = `Log for ${label}`;
          results.push({
            row: rowNumber,
            status: "skipped",
            message: existing ? skipExistsMessage(keyLabel) : skipNoMatchMessage(keyLabel),
          });
        } else {
          const created = await db.workLog.create({
            data: { userId: user.id, workDate, ...data },
          });
          results.push({ row: rowNumber, status: "imported", warnings: warnList(warnings) });
          await logImportActivity(ctx, "imported", "work-log", created.id, `${label} (${hours}h)`);
        }
      } catch (err) {
        results.push({
          row: rowNumber,
          status: "failed",
          message: err instanceof Error ? err.message : "DB error",
        });
      }
    }

    return buildResult(results);
  },
};
