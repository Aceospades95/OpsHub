/**
 * Synthetic email helpers.
 *
 * The Add Employee flow allows admins to create "no-login" employees —
 * tracked in HR/staffing but without a real auth identity. The action
 * generates a placeholder address of the form:
 *
 *   nologin-<timestamp>@internal.local
 *
 * (see `createUser` in src/actions/admin.ts).
 *
 * These addresses must NOT participate in:
 *   - Email-uniqueness duplicate detection (every nologin-* address is
 *     unique by timestamp anyway — but a Real Person who happens to
 *     be a no-login employee shouldn't be blocked by an unrelated
 *     placeholder).
 *   - SSO sign-in flows.
 *   - Outbound email transports (the welcome-email send already skips
 *     no-login users, but downstream logic should treat synthetic
 *     addresses as "no real inbox" too).
 *
 * The Employees table surfaces a small badge next to the synthetic
 * address so admins can see at a glance which rows are placeholder-
 * email accounts (the QA stress test flagged this — the second Jacob
 * Wright row had a nologin-* email and looked indistinguishable from
 * a real account at first glance).
 */

const SYNTHETIC_EMAIL_PATTERN = /^nologin-.+@internal\.local$/i;

export function isSyntheticEmail(
  email: string | null | undefined
): boolean {
  if (!email) return false;
  return SYNTHETIC_EMAIL_PATTERN.test(email.trim());
}
