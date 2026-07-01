import type { Role } from "@prisma/client";

/**
 * The simplified role model (July 2026 rework). OpsHub presents THREE
 * roles going forward:
 *
 *   ADMIN       → "Admin"   — full access to everything, including /admin
 *   MANAGER     → "Manager" — org-wide operational data, no admin settings
 *   CONTRIBUTOR → "Field"   — assigned projects + their own tasks only;
 *                             no contracts, quotes, or financial data
 *
 * The Role enum still carries DEVELOPER / VIEWER / GUEST for existing
 * rows. They keep working (DEVELOPER behaves like an admin without the
 * /admin pages, VIEWER is a read-only Field, GUEST is intranet/team
 * only) but are hidden from the role pickers — see roleOptionsFor().
 * Collapsing the enum itself is deferred until the data has been
 * migrated; see docs/codebase-audit-2026-07.md §8 P1.
 */
export const PRIMARY_ROLES: { value: Role; label: string; description: string }[] = [
  {
    value: "ADMIN",
    label: "Admin",
    description: "Full access to everything, including settings",
  },
  {
    value: "MANAGER",
    label: "Manager",
    description: "All operational data, no admin settings",
  },
  {
    value: "CONTRIBUTOR",
    label: "Field",
    description: "Assigned projects and own tasks — no contracts, quotes, or financials",
  },
];

const LEGACY_ROLE_LABELS: Record<string, string> = {
  DEVELOPER: "Developer (legacy)",
  VIEWER: "Viewer (legacy, read-only Field)",
  GUEST: "Guest (legacy)",
};

/** Display label for any role value, legacy ones included. */
export function roleLabel(role: string): string {
  const primary = PRIMARY_ROLES.find((r) => r.value === role);
  if (primary) return primary.label;
  return LEGACY_ROLE_LABELS[role] ?? role;
}

/**
 * Options for a role <Select>. Always the three primary roles; when the
 * user being edited currently holds a legacy role, that role is appended
 * so the form renders their real value instead of silently coercing it.
 */
export function roleOptionsFor(currentRole?: string | null): { label: string; value: string }[] {
  const options = PRIMARY_ROLES.map((r) => ({ label: r.label, value: r.value as string }));
  if (currentRole && !PRIMARY_ROLES.some((r) => r.value === currentRole)) {
    options.push({ label: roleLabel(currentRole), value: currentRole });
  }
  return options;
}
