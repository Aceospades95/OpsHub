#!/usr/bin/env node
/**
 * Boot-time environment validator.
 *
 * Run by start.sh BEFORE prisma migrate deploy and BEFORE the Next.js
 * server starts. The container exits with a clear, actionable error if
 * any required variable is missing or malformed. The cost of failing
 * fast here is one less crashloop in production.
 *
 * Plain JS (no zod) so this script has zero install-order dependencies
 * — it runs on a freshly-pulled image before anything imports a TS
 * file.
 *
 * Categories:
 *   - REQUIRED: must be set in any environment (dev / staging / prod)
 *   - REQUIRED_IN_PRODUCTION: must be set when NODE_ENV=production
 *   - CONDITIONAL: required when a sibling var has a specific value
 *
 * To add a new env var:
 *   1. Pick the right category below
 *   2. Add a row to RULES with a human-readable description
 *   3. Update .env.example to match
 */

const NODE_ENV = process.env.NODE_ENV || "development";
const isProduction = NODE_ENV === "production";

const errors = [];
const warnings = [];

/**
 * Each rule: { name, level, description, validate? }
 *   level: "required" | "production-only" | "conditional"
 *   validate(value): optional extra check, return null on success or error string
 */
const RULES = [
  // ─── Always required ────────────────────────────────────────
  {
    name: "DATABASE_URL",
    level: "required",
    description:
      "Postgres connection string. Format: postgresql://user:pass@host:port/db?schema=public",
    validate: (v) => {
      if (!v.startsWith("postgresql://") && !v.startsWith("postgres://")) {
        return "must start with postgresql:// or postgres://";
      }
      return null;
    },
  },
  {
    name: "NEXTAUTH_URL",
    level: "required",
    description:
      "Public URL the app is reachable at. Must match the URL users hit in their browser exactly. e.g. https://opshub.yourcompany.com",
    validate: (v) => {
      try {
        new URL(v);
        return null;
      } catch {
        return "is not a valid URL";
      }
    },
  },
  {
    name: "NEXTAUTH_SECRET",
    level: "required",
    description:
      "Random secret for signing NextAuth JWTs. Generate with: openssl rand -base64 32",
    validate: (v) => {
      if (v.length < 32) {
        return `is only ${v.length} characters; needs at least 32 to resist brute-force. Generate a fresh one with 'openssl rand -base64 32'.`;
      }
      // Common placeholder values that mean "unset"
      const placeholders = [
        "your-secret-key-here-generate-with-openssl-rand-base64-32",
        "changeme",
        "secret",
        "TODO",
      ];
      if (placeholders.some((p) => v.toLowerCase().includes(p.toLowerCase()))) {
        return "is still set to a placeholder value. Generate a real one with 'openssl rand -base64 32'.";
      }
      return null;
    },
  },

  // ─── Required in production ─────────────────────────────────
  {
    name: "CRON_SECRET",
    level: "production-only",
    description:
      "Shared secret protecting POST /api/jobs/run. Without it, all scheduled jobs (contract reminders, daily digests, workflow ticking, etc.) silently never fire because every cron call returns 401. Generate with: openssl rand -hex 32",
    validate: (v) => {
      if (v.length < 32) {
        return `is only ${v.length} characters; should be at least 32. Generate with 'openssl rand -hex 32'.`;
      }
      return null;
    },
  },
  {
    name: "EMAIL_DRIVER",
    level: "production-only",
    description:
      "Which email driver to use: 'ses' (AWS SES), 'smtp' (generic SMTP), or 'log' (writes EmailLog rows only — nothing leaves the box). Production must NOT use 'log' or all customer-facing email is silently dropped.",
    validate: (v) => {
      const valid = ["log", "smtp", "ses"];
      if (!valid.includes(v.toLowerCase())) {
        return `is "${v}" — must be one of: ${valid.join(", ")}`;
      }
      if (isProduction && v.toLowerCase() === "log") {
        return "is set to 'log' in production. Real emails will NOT be delivered. Set EMAIL_DRIVER=ses or smtp, or explicitly opt in by setting ALLOW_LOG_DRIVER_IN_PROD=true.";
      }
      return null;
    },
  },
  {
    name: "EMAIL_FROM",
    level: "production-only",
    description:
      "Sender address for every outbound email. Must be a verified sender on the chosen driver (SES verified identity, or the SMTP user mailbox).",
    validate: (v) => {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
        return "is not a valid email address";
      }
      if (v.includes("example.com")) {
        return "is set to a placeholder (contains 'example.com'). Use a real verified sender address.";
      }
      return null;
    },
  },

  // ─── Conditional on EMAIL_DRIVER ────────────────────────────
  {
    name: "SES_REGION",
    level: "conditional",
    when: () => (process.env.EMAIL_DRIVER || "").toLowerCase() === "ses",
    description: "AWS region for SES. Required when EMAIL_DRIVER=ses.",
  },
  {
    name: "SMTP_HOST",
    level: "conditional",
    when: () => (process.env.EMAIL_DRIVER || "").toLowerCase() === "smtp",
    description: "SMTP server hostname. Required when EMAIL_DRIVER=smtp.",
  },
  {
    name: "SMTP_PORT",
    level: "conditional",
    when: () => (process.env.EMAIL_DRIVER || "").toLowerCase() === "smtp",
    description: "SMTP port (typically 465 for TLS, 587 for STARTTLS).",
    validate: (v) => {
      const n = Number.parseInt(v, 10);
      if (!Number.isFinite(n) || n <= 0 || n > 65535) {
        return `is "${v}" — must be a valid TCP port`;
      }
      return null;
    },
  },
  {
    name: "SMTP_USER",
    level: "conditional",
    when: () => (process.env.EMAIL_DRIVER || "").toLowerCase() === "smtp",
    description: "SMTP auth username (also typically the sender mailbox).",
  },
  {
    name: "SMTP_PASSWORD",
    level: "conditional",
    when: () => (process.env.EMAIL_DRIVER || "").toLowerCase() === "smtp",
    description:
      "SMTP password. For Gmail / Workspace, use an app password (not your account password).",
  },

  // ─── Conditional on STORAGE_DRIVER ──────────────────────────
  {
    name: "S3_BUCKET",
    level: "conditional",
    when: () => (process.env.STORAGE_DRIVER || "").toLowerCase() === "s3",
    description: "S3 bucket name. Required when STORAGE_DRIVER=s3.",
  },
  {
    name: "S3_REGION",
    level: "conditional",
    when: () => (process.env.STORAGE_DRIVER || "").toLowerCase() === "s3",
    description: "AWS region the bucket lives in.",
  },

  // ─── Conditional on Google SSO ──────────────────────────────
  {
    name: "GOOGLE_CLIENT_SECRET",
    level: "conditional",
    when: () => !!process.env.GOOGLE_CLIENT_ID,
    description:
      "Google OAuth client secret. Required when GOOGLE_CLIENT_ID is set.",
  },
  {
    name: "GOOGLE_CLIENT_ID",
    level: "conditional",
    when: () => !!process.env.GOOGLE_CLIENT_SECRET,
    description:
      "Google OAuth client id. Required when GOOGLE_CLIENT_SECRET is set.",
  },
];

for (const rule of RULES) {
  const value = process.env[rule.name];
  const present = value !== undefined && value !== "";

  let mustBeSet = false;
  if (rule.level === "required") {
    mustBeSet = true;
  } else if (rule.level === "production-only") {
    mustBeSet = isProduction;
  } else if (rule.level === "conditional") {
    mustBeSet = rule.when ? !!rule.when() : false;
  }

  if (!present) {
    if (mustBeSet) {
      errors.push(
        `${rule.name} is not set.\n      ${rule.description}`
      );
    }
    continue;
  }

  if (rule.validate) {
    const problem = rule.validate(value);
    if (problem) {
      errors.push(`${rule.name} ${problem}\n      ${rule.description}`);
    }
  }
}

// Soft warnings — surface but don't block boot
if (
  isProduction &&
  (process.env.EMAIL_DRIVER || "").toLowerCase() === "log" &&
  process.env.ALLOW_LOG_DRIVER_IN_PROD === "true"
) {
  warnings.push(
    "EMAIL_DRIVER=log is allowed in production via ALLOW_LOG_DRIVER_IN_PROD=true. Real emails will NOT be delivered."
  );
}
if (
  !process.env.STORAGE_DRIVER ||
  process.env.STORAGE_DRIVER.toLowerCase() === "local"
) {
  if (isProduction) {
    warnings.push(
      "STORAGE_DRIVER is unset or 'local' in production. Local-disk storage is ephemeral on container restarts; uploads will be lost. Set STORAGE_DRIVER=s3 with S3_BUCKET / S3_REGION for durable storage."
    );
  }
}
if (!process.env.GOOGLE_CLIENT_ID && !process.env.GOOGLE_CLIENT_SECRET) {
  warnings.push(
    "Google SSO is disabled (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set). Users can only sign in with email/password."
  );
}

// ─── Output ──────────────────────────────────────────────────
if (warnings.length > 0) {
  console.warn("");
  console.warn("⚠️  Environment warnings:");
  for (const w of warnings) {
    console.warn(`   • ${w}`);
  }
}

if (errors.length > 0) {
  console.error("");
  console.error("============================================================");
  console.error(
    `❌  Environment validation FAILED (${errors.length} problem${errors.length === 1 ? "" : "s"}):`
  );
  console.error("============================================================");
  for (const e of errors) {
    console.error(`   • ${e}`);
  }
  console.error("");
  console.error(
    "Refer to .env.example for the full list of supported variables."
  );
  console.error("");
  process.exit(1);
}

console.log(
  `✓ Environment validated (${NODE_ENV}${warnings.length ? `, ${warnings.length} warning${warnings.length === 1 ? "" : "s"}` : ""}).`
);
