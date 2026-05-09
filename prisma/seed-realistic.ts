/**
 * Realistic seed for the OpsHub testing environment.
 *
 * !!! TESTING / DEMO USE ONLY — COMMITS WRITES, NO DRY-RUN !!!
 * --------------------------------------------------------------
 * This script is intended for the testing database only. It writes
 * data unconditionally; there is no preview mode. Do not point it at
 * production. The script is fully idempotent: every insert uses
 * upsert-by-natural-key semantics, so re-running is safe.
 *
 * What it does, in order:
 *   1. Clean up the demo / stress-test residue surfaced by the QA
 *      report (the "123" project, "test" supplier, "TEST" cert,
 *      "Q1 2025 All-Hands Recap", StressTest* tasks).
 *   2. Deactivate the QA-flagged demo employees (Sanya testing,
 *      Testing USer).
 *   3. Run the configured named-pair duplicate-merge inline.
 *   4. Dedupe the Org Chart intranet card collisions.
 *   5. Upsert the realistic dataset (12 clients + projects + tasks +
 *      contracts + quotes + suppliers + subs + partnerships + certs +
 *      tools + intranet articles + workflow templates + activity
 *      backdating + admin notifications + import logs).
 *
 * Email transport is OFF. We write Notification rows directly without
 * routing through src/lib/email/, so seeding never sends a real email.
 *
 * Run with:
 *   npx tsx prisma/seed-realistic.ts
 *   npm run seed:realistic
 */

import { PrismaClient, Prisma } from "@prisma/client";
import { executeMerge } from "../src/lib/merge-users-fk";

const db = new PrismaClient();

// ─── Determinism helpers ─────────────────────────────────────────

/**
 * Deterministic pseudo-random based on a string key. Lets us pick
 * "random" attributes (priority, status, dates) that are stable
 * across re-runs of the seed for the same input.
 */
function seedRandom(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Map to [0, 1)
  return ((h >>> 0) % 100000) / 100000;
}

function pickFrom<T>(key: string, choices: readonly T[]): T {
  const r = seedRandom(key);
  return choices[Math.floor(r * choices.length)];
}

function daysFromNow(d: number): Date {
  return new Date(Date.now() + d * 24 * 60 * 60 * 1000);
}

function backdateMonths(months: number, key: string): Date {
  const r = seedRandom(key);
  const totalMs = months * 30 * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - r * totalMs);
}

const CANONICAL_PASSWORD_PLACEHOLDER = "SEED-NO-LOGIN-PLACEHOLDER";

// ─── Step 1: cleanup-demo-data (no dry-run guard) ───────────────

async function runCleanupDemoData(): Promise<void> {
  console.log("\n[1/5] Cleaning up demo / stress-test residue...");

  // "123" project under Acme Corp — only delete if it has zero attachments.
  const projects123 = await db.project.findMany({
    where: { name: "123", client: { name: "Acme Corp" } },
    include: {
      _count: {
        select: {
          childProjects: true,
          members: true,
          tasks: true,
          contracts: true,
          documents: true,
          assignments: true,
          quotes: true,
          milestones: true,
          projectRoles: true,
        },
      },
    },
  });
  for (const p of projects123) {
    const c = p._count;
    const total =
      c.childProjects +
      c.members +
      c.tasks +
      c.contracts +
      c.documents +
      c.assignments +
      c.quotes +
      c.milestones;
    if (total === 0) {
      await db.project.delete({ where: { id: p.id } });
      console.log(`  deleted project "123"`);
    } else {
      console.log(`  skipped project "123" — ${total} attachment(s)`);
    }
  }

  // Supplier "test" / category "decals".
  const testSuppliers = await db.supplier.findMany({
    where: {
      name: { equals: "test", mode: "insensitive" },
      category: "decals",
    },
    include: { _count: { select: { projects: true, comments: true } } },
  });
  for (const s of testSuppliers) {
    const total = s._count.projects + s._count.comments;
    if (total === 0) {
      await db.supplier.delete({ where: { id: s.id } });
      console.log(`  deleted supplier "test (decals)"`);
    } else {
      console.log(`  skipped supplier "test" — ${total} attachment(s)`);
    }
  }

  // Certification "TEST" with type=OTHER and jurisdiction=OTHER.
  const testCerts = await db.certification.findMany({
    where: { name: { equals: "TEST", mode: "insensitive" } },
    include: { _count: { select: { checklistItems: true, renewalHistory: true } } },
  });
  for (const c of testCerts) {
    const isOther = c.type === "OTHER" && c.jurisdictionLevel === "OTHER";
    if (!isOther) continue;
    const total = c._count.checklistItems + c._count.renewalHistory + (c.signedOffAt ? 1 : 0);
    if (total === 0) {
      await db.certification.delete({ where: { id: c.id } });
      console.log(`  deleted certification "TEST"`);
    } else {
      console.log(`  skipped certification "TEST" — ${total} attachment(s)`);
    }
  }

  // Q1 2025 announcement.
  const q1Announcements = await db.intranetResource.findMany({
    where: {
      title: { equals: "Q1 2025 All-Hands Recap", mode: "insensitive" },
      category: "ANNOUNCEMENT",
    },
    include: { _count: { select: { links: true, embeds: true } } },
  });
  for (const r of q1Announcements) {
    const total = r._count.links + r._count.embeds;
    if (total === 0) {
      await db.intranetResource.delete({ where: { id: r.id } });
      console.log(`  deleted intranet "Q1 2025 All-Hands Recap"`);
    } else {
      console.log(`  skipped Q1 2025 announcement — ${total} attachment(s)`);
    }
  }

  // StressTest tasks.
  for (const title of [
    "StressTestTaskA",
    "StressTestTaskB",
    "STRESS TEST TASK - past due date",
  ]) {
    const tasks = await db.task.findMany({
      where: { title: { equals: title, mode: "insensitive" } },
    });
    for (const t of tasks) {
      await db.task.delete({ where: { id: t.id } });
      console.log(`  deleted task "${t.title}"`);
    }
  }
}

// ─── Step 2: cleanup-demo-employees ─────────────────────────────

/**
 * Read cleanup targets from `SEED_CLEANUP_USER_TARGETS`. The env var
 * holds a JSON array of `{ name, email? }` objects. Default (env unset
 * or empty): no targets — the step is inert. This keeps real PII out
 * of the repo: when an operator needs to deactivate a specific demo
 * employee, they pass the names/emails at runtime, not in source.
 *
 *   SEED_CLEANUP_USER_TARGETS='[{"name":"Demo User","email":"demo@example.com"}]'
 */
function readCleanupTargets(): { name: string; email: string | null }[] {
  const raw = process.env.SEED_CLEANUP_USER_TARGETS;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t): t is { name: string; email?: string } => typeof t?.name === "string")
      .map((t) => ({ name: t.name, email: t.email ?? null }));
  } catch {
    console.warn("  SEED_CLEANUP_USER_TARGETS is set but not valid JSON; ignoring");
    return [];
  }
}

async function runCleanupDemoEmployees(): Promise<void> {
  console.log("\n[2/5] Deactivating demo employees...");
  const targets = readCleanupTargets();
  if (targets.length === 0) {
    console.log("  no SEED_CLEANUP_USER_TARGETS configured; skipping");
    return;
  }

  for (const target of targets) {
    const candidates = await db.user.findMany({
      where: target.email
        ? { name: { equals: target.name, mode: "insensitive" }, email: target.email }
        : { name: { equals: target.name, mode: "insensitive" } },
      include: {
        _count: { select: { assignments: true, projectMembers: true, assignedTasks: true } },
      },
    });
    if (candidates.length !== 1) {
      console.log(`  ${target.name}: ${candidates.length} match(es), skipping`);
      continue;
    }
    const c = candidates[0];
    if (!c.isActive) continue;
    const att = c._count.assignments + c._count.projectMembers + c._count.assignedTasks;
    if (att > 0) {
      console.log(`  refusing to deactivate "${c.name}" — ${att} attachment(s)`);
      continue;
    }
    await db.user.update({
      where: { id: c.id },
      data: { isActive: false, hasLoginAccess: false },
    });
    console.log(`  deactivated "${c.name}" <${c.email}>`);
  }
}

// ─── Step 3: merge a duplicate-named user pair ──────────────────

/**
 * Inert by default. To opt in, set
 *   SEED_MERGE_TARGET_NAME="Jane Doe"
 *   SEED_MERGE_TARGET_EMAIL="jane.doe@example.com"
 * The merge collapses two User rows that share `name` into one keeper:
 * the keeper is the row with a synthetic `nologin-...@internal.local`
 * email; the source is the row whose email matches
 * SEED_MERGE_TARGET_EMAIL. After the FK walk the keeper's email is
 * renamed to the target email so it carries the canonical address.
 *
 * The standalone `prisma/merge-named-user.ts` and
 * `prisma/merge-users-by-id.ts` scripts still exist for case-by-case
 * operator use; this step is just the seed-time hook.
 */
async function runNamedPairMerge(): Promise<void> {
  console.log("\n[3/5] Merging duplicate user pair if configured...");
  const targetName = process.env.SEED_MERGE_TARGET_NAME?.trim();
  const targetEmail = process.env.SEED_MERGE_TARGET_EMAIL?.trim().toLowerCase();
  if (!targetName || !targetEmail) {
    console.log("  no SEED_MERGE_TARGET_NAME / SEED_MERGE_TARGET_EMAIL configured; skipping");
    return;
  }
  const candidates = await db.user.findMany({
    where: { name: { equals: targetName, mode: "insensitive" } },
    include: { _count: { select: { assignments: true, projectMembers: true } } },
    orderBy: { createdAt: "asc" },
  });
  if (candidates.length < 2) {
    console.log(`  found ${candidates.length} '${targetName}' row(s); nothing to merge`);
    return;
  }
  if (candidates.length > 2) {
    console.log(`  found ${candidates.length} '${targetName}' rows; refusing — ambiguous shape`);
    return;
  }
  const SYNTHETIC = /^nologin-.*@internal\.local$/i;
  const keeper = candidates.find((c) => SYNTHETIC.test(c.email));
  const source = candidates.find((c) => c.email.trim().toLowerCase() === targetEmail);
  if (!keeper || !source) {
    console.log("  data shape doesn't match (synthetic + canonical); skipping");
    return;
  }
  const keeperLoad = keeper._count.assignments + keeper._count.projectMembers;
  const sourceLoad = source._count.assignments + source._count.projectMembers;
  if (sourceLoad > keeperLoad) {
    console.log("  canonical row has more attachments than synthetic — refusing to merge");
    return;
  }
  await executeMerge(db, source.id, keeper.id, { targetEmail });
  console.log(`  merged '${targetName}' duplicates`);
}

// ─── Step 4: dedupe Org Chart intranet ──────────────────────────

async function runDedupeOrgChart(): Promise<void> {
  console.log("\n[4/5] Deduplicating intranet Org Chart entries...");
  const orgChartResources = await db.intranetResource.findMany({
    where: { category: "ORG_CHART" },
    orderBy: { createdAt: "asc" },
  });
  if (orgChartResources.length <= 1) {
    console.log(`  ${orgChartResources.length} ORG_CHART resource(s); nothing to dedupe`);
    return;
  }
  const [, ...dupes] = orgChartResources;
  for (const d of dupes) {
    await db.intranetResource.update({
      where: { id: d.id },
      data: { published: false, pinned: false },
    });
  }
  console.log(`  archived ${dupes.length} duplicate Org Chart resource(s)`);
}

// ─── Realistic dataset definitions ──────────────────────────────

const CLIENT_DEFS: Array<{
  name: string;
  industry: string;
  domain: string;
  status: "ACTIVE" | "PROSPECT" | "INACTIVE";
  description: string;
  contacts: { name: string; title: string; isPrimary?: boolean }[];
}> = [
  // Manufacturing (3)
  {
    name: "Bedrock Industrial Co.",
    industry: "Manufacturing",
    domain: "bedrockindustrial.example.com",
    status: "ACTIVE",
    description: "Mid-market industrial fastener and machined parts producer.",
    contacts: [
      { name: "Helen Garrett", title: "VP Operations", isPrimary: true },
      { name: "Marcus Doyle", title: "Plant Manager" },
      { name: "Priya Sundar", title: "Procurement Lead" },
    ],
  },
  {
    name: "NorthRail Components",
    industry: "Manufacturing",
    domain: "northrailcomp.example.com",
    status: "ACTIVE",
    description: "Tier-2 supplier of rolling stock subcomponents to North American rail.",
    contacts: [
      { name: "Beatrice Rowe", title: "Director of Supply Chain", isPrimary: true },
      { name: "Felix Marsden", title: "QA Manager" },
    ],
  },
  {
    name: "Halcyon Plastics LLC",
    industry: "Manufacturing",
    domain: "halcyonplastics.example.com",
    status: "PROSPECT",
    description: "Injection-molded plastics for the consumer goods sector.",
    contacts: [
      { name: "Sergio Ramirez", title: "GM", isPrimary: true },
      { name: "Quinn Albright", title: "Plant Engineer" },
      { name: "Lila Hartwell", title: "Sales Director" },
    ],
  },
  // Tech (3)
  {
    name: "Trailfork Software",
    industry: "Tech",
    domain: "trailfork.example.com",
    status: "ACTIVE",
    description: "B2B SaaS for outdoor logistics planning.",
    contacts: [
      { name: "Jess Alvarez", title: "CTO", isPrimary: true },
      { name: "Tomás Ortiz", title: "VP Engineering" },
      { name: "Ngozi Adesanya", title: "Head of Customer Success" },
    ],
  },
  {
    name: "Lattice Cloud Systems",
    industry: "Tech",
    domain: "latticecloud.example.com",
    status: "ACTIVE",
    description: "Cloud platform reseller and managed-services partner.",
    contacts: [
      { name: "Wallace Chen", title: "VP Sales", isPrimary: true },
      { name: "Brielle Okafor", title: "Solutions Architect" },
    ],
  },
  {
    name: "Pinedrop Analytics",
    industry: "Tech",
    domain: "pinedropanalytics.example.com",
    status: "INACTIVE",
    description: "Advanced analytics consultancy — engagement paused.",
    contacts: [
      { name: "Reese Whitaker", title: "Founder", isPrimary: true },
      { name: "Maya Goldberg", title: "Lead Data Scientist" },
    ],
  },
  // Healthcare (3)
  {
    name: "Glenmoor Medical Group",
    industry: "Healthcare",
    domain: "glenmoormed.example.com",
    status: "ACTIVE",
    description: "Multi-specialty physician practice with HIPAA modernization needs.",
    contacts: [
      { name: "Dr. Anand Iyer", title: "Chief Medical Officer", isPrimary: true },
      { name: "Carla Benitez", title: "Practice Administrator" },
      { name: "Emery Park", title: "Compliance Officer" },
    ],
  },
  {
    name: "RidgeView Hospital System",
    industry: "Healthcare",
    domain: "ridgeviewhealth.example.com",
    status: "ACTIVE",
    description: "Regional hospital network — patient portal and HIPAA initiatives.",
    contacts: [
      { name: "Dr. Lillian Crowe", title: "CIO", isPrimary: true },
      { name: "Renée Aoki", title: "VP IT Operations" },
    ],
  },
  {
    name: "VitaCircle Health",
    industry: "Healthcare",
    domain: "vitacirclehealth.example.com",
    status: "PROSPECT",
    description: "Virtual-first primary care clinic, exploring vendor relationship.",
    contacts: [
      { name: "Cory Henson", title: "COO", isPrimary: true },
      { name: "Aisha Damji", title: "Clinical Lead" },
    ],
  },
  // Real Estate (3)
  {
    name: "Holloway Property Group",
    industry: "Real Estate",
    domain: "hollowayrealestate.example.com",
    status: "ACTIVE",
    description: "Commercial property management across the Midwest.",
    contacts: [
      { name: "Frederick Bauer", title: "Managing Partner", isPrimary: true },
      { name: "Sasha Lin", title: "Director of Asset Mgmt." },
      { name: "Owen Weatherly", title: "Facilities Lead" },
    ],
  },
  {
    name: "Civic Crossing Realty",
    industry: "Real Estate",
    domain: "civiccrossingrealty.example.com",
    status: "ACTIVE",
    description: "Mixed-use developer with retail and residential portfolios.",
    contacts: [
      { name: "Margot Chen", title: "VP Development", isPrimary: true },
      { name: "Jordan Petruzzi", title: "Project Coordinator" },
    ],
  },
  {
    name: "Brookhaven Estates",
    industry: "Real Estate",
    domain: "brookhavenestates.example.com",
    status: "PROSPECT",
    description: "Luxury residential brokerage — early discovery phase.",
    contacts: [
      { name: "Amelia Bishop", title: "Principal Broker", isPrimary: true },
      { name: "Tariq Sahari", title: "Operations Manager" },
    ],
  },
];

const PROJECT_DEFS: Array<{
  name: string;
  clientName: string;
  status: "PLANNING" | "ACTIVE" | "ON_HOLD" | "COMPLETED";
  startDays: number; // relative to today (negative = past)
  endDays: number;
  childOf?: string; // parent project name when sub-project
}> = [
  // Manufacturing
  { name: "Q3 Fleet Telematics Rollout", clientName: "Bedrock Industrial Co.", status: "ACTIVE", startDays: -120, endDays: 60 },
  { name: "Plant Floor Wi-Fi Upgrade", clientName: "Bedrock Industrial Co.", status: "PLANNING", startDays: 30, endDays: 180 },
  { name: "Telematics – Eastern Yard Pilot", clientName: "Bedrock Industrial Co.", status: "ACTIVE", startDays: -90, endDays: 30, childOf: "Q3 Fleet Telematics Rollout" },
  { name: "Telematics – Western Yard Rollout", clientName: "Bedrock Industrial Co.", status: "PLANNING", startDays: -30, endDays: 120, childOf: "Q3 Fleet Telematics Rollout" },
  { name: "Vendor QA Portal", clientName: "NorthRail Components", status: "ACTIVE", startDays: -200, endDays: 90 },
  { name: "Predictive Maintenance Pilot", clientName: "NorthRail Components", status: "ON_HOLD", startDays: -60, endDays: 60 },
  { name: "Tooling Cost Audit", clientName: "Halcyon Plastics LLC", status: "PLANNING", startDays: 15, endDays: 120 },

  // Tech
  { name: "ERP Migration Phase 2", clientName: "Trailfork Software", status: "ACTIVE", startDays: -150, endDays: 120 },
  { name: "ERP Migration – Finance Module", clientName: "Trailfork Software", status: "ACTIVE", startDays: -90, endDays: 60, childOf: "ERP Migration Phase 2" },
  { name: "ERP Migration – Inventory Module", clientName: "Trailfork Software", status: "PLANNING", startDays: 0, endDays: 120, childOf: "ERP Migration Phase 2" },
  { name: "ERP Migration – Reporting Cutover", clientName: "Trailfork Software", status: "PLANNING", startDays: 30, endDays: 150, childOf: "ERP Migration Phase 2" },
  { name: "DevOps Maturity Assessment", clientName: "Trailfork Software", status: "COMPLETED", startDays: -300, endDays: -120 },
  { name: "Cloud Cost Optimization", clientName: "Lattice Cloud Systems", status: "ACTIVE", startDays: -45, endDays: 75 },
  { name: "AWS Landing Zone Buildout", clientName: "Lattice Cloud Systems", status: "ACTIVE", startDays: -75, endDays: 120 },
  { name: "Q4 Roadmap Workshop", clientName: "Pinedrop Analytics", status: "COMPLETED", startDays: -240, endDays: -180 },

  // Healthcare
  { name: "HIPAA Compliance Audit", clientName: "Glenmoor Medical Group", status: "ACTIVE", startDays: -90, endDays: 30 },
  { name: "Patient Portal Modernization", clientName: "Glenmoor Medical Group", status: "PLANNING", startDays: 60, endDays: 270 },
  { name: "EHR Vendor Evaluation", clientName: "RidgeView Hospital System", status: "ACTIVE", startDays: -30, endDays: 120 },
  { name: "Network Segmentation Project", clientName: "RidgeView Hospital System", status: "ACTIVE", startDays: -180, endDays: 90 },
  { name: "Telehealth Platform Integration", clientName: "VitaCircle Health", status: "PLANNING", startDays: 30, endDays: 240 },

  // Real Estate
  { name: "Lease Abstraction Pilot", clientName: "Holloway Property Group", status: "ACTIVE", startDays: -60, endDays: 90 },
  { name: "Tenant Portal Refresh", clientName: "Holloway Property Group", status: "PLANNING", startDays: 30, endDays: 180 },
  { name: "Smart Building IoT Pilot", clientName: "Civic Crossing Realty", status: "COMPLETED", startDays: -360, endDays: -90 },
  { name: "Brokerage CRM Implementation", clientName: "Brookhaven Estates", status: "PLANNING", startDays: 45, endDays: 240 },
  { name: "Capital Stack Analytics Dashboard", clientName: "Civic Crossing Realty", status: "ON_HOLD", startDays: -60, endDays: 60 },
];

const NEW_EMPLOYEE_DEFS: Array<{
  name: string;
  jobTitle: string;
  department: string;
  managerName?: string;
  role?: "ADMIN" | "MANAGER" | "DEVELOPER" | "CONTRIBUTOR";
}> = [
  // Top
  { name: "Maria Hernandez", jobTitle: "Chief Operating Officer", department: "Executive", role: "ADMIN" },
  { name: "Daniel Chen", jobTitle: "Chief Technology Officer", department: "Engineering", role: "ADMIN" },
  // VPs reporting to C-suite
  { name: "Priya Patel", jobTitle: "VP Client Services", department: "Client Services", managerName: "Maria Hernandez", role: "MANAGER" },
  { name: "Andre Whitfield", jobTitle: "VP Engineering", department: "Engineering", managerName: "Daniel Chen", role: "MANAGER" },
  { name: "Olivia Brennan", jobTitle: "VP Sales", department: "Sales", managerName: "Maria Hernandez", role: "MANAGER" },
  // Directors reporting to VPs
  { name: "Karim El-Amin", jobTitle: "Director of Engineering", department: "Engineering", managerName: "Andre Whitfield", role: "MANAGER" },
  { name: "Hannah Lindgren", jobTitle: "Director of Compliance", department: "Compliance", managerName: "Priya Patel", role: "MANAGER" },
  { name: "Owen Tanaka", jobTitle: "Director of Operations", department: "Operations", managerName: "Maria Hernandez", role: "MANAGER" },
  // Managers / leads
  { name: "Sofia Castellanos", jobTitle: "Engineering Manager", department: "Engineering", managerName: "Karim El-Amin", role: "MANAGER" },
  { name: "Rashid Quereshi", jobTitle: "Senior Project Manager", department: "Operations", managerName: "Owen Tanaka", role: "CONTRIBUTOR" },
  // ICs
  { name: "Jamal Carter", jobTitle: "Senior Software Engineer", department: "Engineering", managerName: "Sofia Castellanos", role: "DEVELOPER" },
  { name: "Lena Vasquez", jobTitle: "Software Engineer", department: "Engineering", managerName: "Sofia Castellanos", role: "DEVELOPER" },
  { name: "Theo Nakashima", jobTitle: "Compliance Analyst", department: "Compliance", managerName: "Hannah Lindgren", role: "CONTRIBUTOR" },
  { name: "Esme Walters", jobTitle: "Account Executive", department: "Sales", managerName: "Olivia Brennan", role: "CONTRIBUTOR" },
  { name: "Bryn Holloway", jobTitle: "Solutions Consultant", department: "Client Services", managerName: "Priya Patel", role: "CONTRIBUTOR" },
];

const SUPPLIER_DEFS: Array<{ name: string; category: string; contactName: string; contactEmail: string; domain: string }> = [
  { name: "Sterling Office Supply", category: "Office Supplies", contactName: "Erica Boone", contactEmail: "erica@sterlingoffice.example.com", domain: "sterlingoffice.example.com" },
  { name: "Apex IT Hardware", category: "IT Hardware", contactName: "Mason Reilly", contactEmail: "sales@apexithw.example.com", domain: "apexithw.example.com" },
  { name: "Maple & Vine Catering", category: "Catering", contactName: "Renata Voss", contactEmail: "events@mapleandvine.example.com", domain: "mapleandvine.example.com" },
  { name: "Holcombe Legal Services", category: "Legal", contactName: "Roy Holcombe", contactEmail: "roy@holcombelegal.example.com", domain: "holcombelegal.example.com" },
  { name: "Mainline Construction Co.", category: "Construction", contactName: "Diana Wexler", contactEmail: "diana@mainlinecc.example.com", domain: "mainlinecc.example.com" },
  { name: "Bridgewater Marketing Group", category: "Marketing", contactName: "Trent Bramwell", contactEmail: "trent@bridgewatermkt.example.com", domain: "bridgewatermkt.example.com" },
  { name: "Crystal Clear Cleaning", category: "Cleaning", contactName: "Esther Donato", contactEmail: "esther@crystalclearclean.example.com", domain: "crystalclearclean.example.com" },
  { name: "Northstar HR Partners", category: "HR", contactName: "Vivian Reyes", contactEmail: "v.reyes@northstarhrp.example.com", domain: "northstarhrp.example.com" },
];

const SUBCONTRACTOR_DEFS: Array<{ name: string; type: "INDIVIDUAL" | "COMPANY" | "AGENCY"; specialties: string[]; primaryContactName: string; primaryContactEmail: string }> = [
  { name: "Rivera Cloud Engineering", type: "COMPANY", specialties: ["AWS", "Terraform", "Kubernetes"], primaryContactName: "Cesar Rivera", primaryContactEmail: "cesar@riveracloud.example.com" },
  { name: "Lakeside Data Group", type: "COMPANY", specialties: ["Snowflake", "dbt", "Analytics"], primaryContactName: "Anya Larsson", primaryContactEmail: "anya@lakesidedata.example.com" },
  { name: "Marlow Compliance Consulting", type: "INDIVIDUAL", specialties: ["HIPAA", "SOC 2", "Audit Prep"], primaryContactName: "Patricia Marlow", primaryContactEmail: "patricia@marlowcompliance.example.com" },
  { name: "Forge UX Studio", type: "AGENCY", specialties: ["Product Design", "UX Research"], primaryContactName: "Devon Yates", primaryContactEmail: "hello@forgeux.example.com" },
  { name: "Quill Technical Writing", type: "INDIVIDUAL", specialties: ["API Docs", "User Manuals"], primaryContactName: "Imogen Brackett", primaryContactEmail: "imogen@quilltechwriting.example.com" },
];

const PARTNERSHIP_DEFS: Array<{
  name: string;
  type: "STRATEGIC" | "REFERRAL" | "RESELLER" | "TECHNOLOGY" | "CHANNEL";
  tier: "PLATINUM" | "GOLD" | "SILVER" | "BRONZE";
  industry: string;
  contacts: { name: string; title: string }[];
  domain: string;
}> = [
  {
    name: "Westwind Cloud Alliance",
    type: "TECHNOLOGY",
    tier: "PLATINUM",
    industry: "Cloud",
    domain: "westwindcloud.example.com",
    contacts: [
      { name: "Hugo Mendel", title: "Partner Manager" },
      { name: "Sophia Lee", title: "Solutions Engineer" },
      { name: "Elena Korhonen", title: "Channel Director" },
    ],
  },
  {
    name: "Aspen Strategic Group",
    type: "STRATEGIC",
    tier: "GOLD",
    industry: "Consulting",
    domain: "aspenstrategicgroup.example.com",
    contacts: [
      { name: "Maxine Doherty", title: "Managing Director" },
      { name: "Conrad Yoo", title: "Senior Advisor" },
    ],
  },
  {
    name: "Beacon Health Partners",
    type: "REFERRAL",
    tier: "SILVER",
    industry: "Healthcare",
    domain: "beaconhealthpartners.example.com",
    contacts: [
      { name: "Dr. Naomi Foster", title: "CEO" },
    ],
  },
  {
    name: "Granite Reseller Network",
    type: "RESELLER",
    tier: "BRONZE",
    industry: "Distribution",
    domain: "graniteresellers.example.com",
    contacts: [
      { name: "Phoebe Harrigan", title: "Channel Lead" },
      { name: "Yuri Volkov", title: "Account Manager" },
    ],
  },
];

const CONTRACT_DEFS: Array<{
  title: string;
  type: "MSA" | "SOW" | "NDA";
  clientName: string;
  projectName?: string;
  startDays: number;
  endDays: number;
  renewalDays: number; // relative to today
  value?: number;
}> = [
  // MSAs
  { title: "Bedrock Industrial — Master Services Agreement", type: "MSA", clientName: "Bedrock Industrial Co.", startDays: -400, endDays: 320, renewalDays: 320, value: 500000 },
  { title: "Trailfork — Master Services Agreement", type: "MSA", clientName: "Trailfork Software", startDays: -300, endDays: 65, renewalDays: 14, value: 360000 }, // renewal soon
  { title: "Glenmoor Medical — Master Services Agreement", type: "MSA", clientName: "Glenmoor Medical Group", startDays: -200, endDays: 165, renewalDays: 28, value: 240000 }, // renewal soon
  { title: "Holloway Property — Master Services Agreement", type: "MSA", clientName: "Holloway Property Group", startDays: -250, endDays: 110, renewalDays: 25, value: 180000 }, // renewal soon
  { title: "RidgeView — Master Services Agreement", type: "MSA", clientName: "RidgeView Hospital System", startDays: -130, endDays: 235, renewalDays: 235, value: 420000 },
  { title: "Lattice Cloud — Master Services Agreement", type: "MSA", clientName: "Lattice Cloud Systems", startDays: -90, endDays: 275, renewalDays: 275, value: 200000 },
  // SOWs
  { title: "Bedrock — SOW: Q3 Fleet Telematics Rollout", type: "SOW", clientName: "Bedrock Industrial Co.", projectName: "Q3 Fleet Telematics Rollout", startDays: -120, endDays: 60, renewalDays: 60, value: 145000 },
  { title: "Trailfork — SOW: ERP Migration Phase 2", type: "SOW", clientName: "Trailfork Software", projectName: "ERP Migration Phase 2", startDays: -150, endDays: 120, renewalDays: 120, value: 220000 },
  { title: "Glenmoor — SOW: HIPAA Compliance Audit", type: "SOW", clientName: "Glenmoor Medical Group", projectName: "HIPAA Compliance Audit", startDays: -90, endDays: 30, renewalDays: 30, value: 80000 },
  { title: "RidgeView — SOW: EHR Vendor Evaluation", type: "SOW", clientName: "RidgeView Hospital System", projectName: "EHR Vendor Evaluation", startDays: -30, endDays: 120, renewalDays: 120, value: 65000 },
  { title: "Holloway — SOW: Lease Abstraction Pilot", type: "SOW", clientName: "Holloway Property Group", projectName: "Lease Abstraction Pilot", startDays: -60, endDays: 90, renewalDays: 90, value: 50000 },
  { title: "Lattice — SOW: Cloud Cost Optimization", type: "SOW", clientName: "Lattice Cloud Systems", projectName: "Cloud Cost Optimization", startDays: -45, endDays: 75, renewalDays: 75, value: 70000 },
  { title: "NorthRail — SOW: Vendor QA Portal", type: "SOW", clientName: "NorthRail Components", projectName: "Vendor QA Portal", startDays: -200, endDays: 90, renewalDays: 90, value: 130000 },
  { title: "Civic Crossing — SOW: Smart Building IoT Pilot", type: "SOW", clientName: "Civic Crossing Realty", projectName: "Smart Building IoT Pilot", startDays: -360, endDays: -90, renewalDays: -90, value: 90000 },
  // NDAs
  { title: "Halcyon Plastics — Mutual NDA", type: "NDA", clientName: "Halcyon Plastics LLC", startDays: -30, endDays: 700, renewalDays: 700 },
  { title: "VitaCircle — Mutual NDA", type: "NDA", clientName: "VitaCircle Health", startDays: -45, endDays: 685, renewalDays: 685 },
  { title: "Brookhaven Estates — Mutual NDA", type: "NDA", clientName: "Brookhaven Estates", startDays: -20, endDays: 710, renewalDays: 710 },
  { title: "Pinedrop Analytics — Mutual NDA", type: "NDA", clientName: "Pinedrop Analytics", startDays: -300, endDays: 65, renewalDays: 65 },
];

const QUOTE_DEFS: Array<{
  title: string;
  clientName: string;
  projectName?: string;
  status: "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED";
  total: number;
}> = [
  // Drafts (3)
  { title: "Tooling Cost Audit — Discovery Quote", clientName: "Halcyon Plastics LLC", projectName: "Tooling Cost Audit", status: "DRAFT", total: 18000 },
  { title: "VitaCircle Telehealth Integration — Phase 1", clientName: "VitaCircle Health", projectName: "Telehealth Platform Integration", status: "DRAFT", total: 95000 },
  { title: "Brookhaven CRM Implementation", clientName: "Brookhaven Estates", projectName: "Brokerage CRM Implementation", status: "DRAFT", total: 60000 },
  // Sent (4)
  { title: "Patient Portal Modernization — SOW Draft", clientName: "Glenmoor Medical Group", projectName: "Patient Portal Modernization", status: "SENT", total: 140000 },
  { title: "Tenant Portal Refresh — Proposal", clientName: "Holloway Property Group", projectName: "Tenant Portal Refresh", status: "SENT", total: 75000 },
  { title: "Plant Floor Wi-Fi Upgrade", clientName: "Bedrock Industrial Co.", projectName: "Plant Floor Wi-Fi Upgrade", status: "SENT", total: 120000 },
  { title: "AWS Landing Zone Buildout — Phase 1", clientName: "Lattice Cloud Systems", projectName: "AWS Landing Zone Buildout", status: "SENT", total: 85000 },
  // Accepted (3)
  { title: "Vendor QA Portal — Accepted Quote", clientName: "NorthRail Components", projectName: "Vendor QA Portal", status: "ACCEPTED", total: 130000 },
  { title: "ERP Migration Phase 2 — Accepted", clientName: "Trailfork Software", projectName: "ERP Migration Phase 2", status: "ACCEPTED", total: 220000 },
  { title: "Network Segmentation Project — Q1 SOW", clientName: "RidgeView Hospital System", projectName: "Network Segmentation Project", status: "ACCEPTED", total: 175000 },
  // Rejected (2)
  { title: "Capital Stack Dashboard — V1 Proposal", clientName: "Civic Crossing Realty", projectName: "Capital Stack Analytics Dashboard", status: "REJECTED", total: 110000 },
  { title: "Predictive Maintenance Pilot — Initial Bid", clientName: "NorthRail Components", projectName: "Predictive Maintenance Pilot", status: "REJECTED", total: 65000 },
];

const CERT_DEFS: Array<{
  name: string;
  type: "INDUSTRY" | "COMPLIANCE" | "SAFETY" | "PROFESSIONAL" | "QUALITY" | "SECURITY" | "VENDOR";
  status: "ACTIVE" | "EXPIRING_SOON" | "PENDING";
  expirationDays: number;
  issuingBody: string;
  jurisdictionLevel: "FEDERAL" | "STATE" | "PRIVATE" | "AGENCY";
}> = [
  { name: "SOC 2 Type II — Org-wide", type: "COMPLIANCE", status: "ACTIVE", expirationDays: 45, issuingBody: "AICPA / external auditor", jurisdictionLevel: "PRIVATE" },
  { name: "HIPAA Privacy Officer Designation", type: "COMPLIANCE", status: "ACTIVE", expirationDays: 30, issuingBody: "HHS OCR", jurisdictionLevel: "FEDERAL" },
  { name: "AWS Solutions Architect — Associate", type: "PROFESSIONAL", status: "ACTIVE", expirationDays: 540, issuingBody: "Amazon Web Services", jurisdictionLevel: "PRIVATE" },
  { name: "AWS Solutions Architect — Professional", type: "PROFESSIONAL", status: "ACTIVE", expirationDays: 720, issuingBody: "Amazon Web Services", jurisdictionLevel: "PRIVATE" },
  { name: "PMP — Project Management Professional", type: "PROFESSIONAL", status: "ACTIVE", expirationDays: 365, issuingBody: "Project Management Institute", jurisdictionLevel: "PRIVATE" },
  { name: "OSHA-30 General Industry", type: "SAFETY", status: "ACTIVE", expirationDays: 55, issuingBody: "OSHA", jurisdictionLevel: "FEDERAL" },
  { name: "ISO 27001 — Information Security", type: "SECURITY", status: "ACTIVE", expirationDays: 480, issuingBody: "ISO", jurisdictionLevel: "PRIVATE" },
  { name: "ISO 9001 — Quality Management", type: "QUALITY", status: "ACTIVE", expirationDays: 600, issuingBody: "ISO", jurisdictionLevel: "PRIVATE" },
  { name: "Illinois Business License Renewal", type: "INDUSTRY", status: "ACTIVE", expirationDays: 380, issuingBody: "State of Illinois", jurisdictionLevel: "STATE" },
  { name: "CompTIA Security+", type: "PROFESSIONAL", status: "PENDING", expirationDays: 1095, issuingBody: "CompTIA", jurisdictionLevel: "PRIVATE" },
];

const TOOL_DEFS: Array<{ name: string; description: string; toolUrl: string; category: string }> = [
  { name: "Figma", description: "Collaborative design and prototyping platform.", toolUrl: "https://figma.com", category: "automation" },
  { name: "Notion", description: "Wiki and project notes for the team.", toolUrl: "https://notion.so", category: "report" },
  { name: "GitHub", description: "Source control and CI hosting.", toolUrl: "https://github.com", category: "automation" },
  { name: "Slack", description: "Team chat and integrations.", toolUrl: "https://slack.com", category: "automation" },
  { name: "AWS", description: "Primary cloud provider.", toolUrl: "https://aws.amazon.com", category: "automation" },
  { name: "Datadog", description: "Application observability and alerting.", toolUrl: "https://datadoghq.com", category: "tracker" },
];

const INTRANET_DEFS: Array<{
  title: string;
  category: "ANNOUNCEMENT" | "HR_POLICY" | "GENERAL_RESOURCE" | "EXPENSE_REPORT" | "TIME_OFF" | "FORM" | "SOP";
  content: string;
  pinned?: boolean;
}> = [
  {
    title: "Welcome to OpsHub — A Note from Leadership",
    category: "ANNOUNCEMENT",
    pinned: true,
    content: "Hi team — welcome to the OpsHub workspace. This is where we will track clients, projects, contracts, and the day-to-day operational rhythm of the firm. Please take a moment to explore the modules and report any rough edges. Cheers, leadership.",
  },
  {
    title: "Holiday Calendar 2026",
    category: "GENERAL_RESOURCE",
    content: "Observed holidays for 2026: New Year's Day, Memorial Day, Independence Day, Labor Day, Thanksgiving, the day after Thanksgiving, and Christmas Day. Floating holidays should be coordinated with your manager.",
  },
  {
    title: "Expense Reimbursement Policy",
    category: "EXPENSE_REPORT",
    content: "Submit expenses within 30 days of the transaction via the Expense Report form. Keep receipts for any line item over $25. Travel above $500 must be pre-approved by your director.",
  },
  {
    title: "HIPAA Annual Training",
    category: "HR_POLICY",
    content: "All staff with access to client PHI must complete the HIPAA refresher training each year. Training is available through the compliance portal — please log your completion in this resource.",
  },
  {
    title: "Time Off Request Procedure",
    category: "TIME_OFF",
    content: "Submit time off requests at least two weeks in advance for 1-3 day absences and 30 days in advance for week-long absences. Coordinate coverage with your team lead before submitting.",
  },
  {
    title: "Standard Operating Procedure — Client Onboarding",
    category: "SOP",
    content: "1) Run intake call. 2) Open client record in OpsHub. 3) Stand up project + initial SOW. 4) Schedule kickoff with stakeholders. 5) Document client preferences in the client notes.",
  },
  {
    title: "Remote Work Guidelines",
    category: "HR_POLICY",
    content: "We support hybrid work. Coordinate in-office days with your team lead. Maintain core hours of 10 AM - 3 PM in your local time zone for collaboration windows.",
  },
  {
    title: "IT Help Desk — How to Request Support",
    category: "GENERAL_RESOURCE",
    content: "Open a ticket via the IT Help Desk form. Include screenshots and a description of the issue. For urgent outages, page the on-call engineer in the #it-helpdesk Slack channel.",
  },
];

// ─── Step 5: realistic dataset ───────────────────────────────────

interface SeedCounts {
  clients: number;
  clientContacts: number;
  projects: number;
  projectMembers: number;
  tasks: number;
  employees: number;
  suppliers: number;
  supplierProjects: number;
  subcontractors: number;
  subcontractorContacts: number;
  partnerships: number;
  partnershipContacts: number;
  contracts: number;
  quotes: number;
  certifications: number;
  tools: number;
  intranetArticles: number;
  workflowTemplates: number;
  activityLogs: number;
  notifications: number;
  importLogs: number;
}

async function upsertClient(def: (typeof CLIENT_DEFS)[number]): Promise<{ id: string; created: boolean }> {
  const existing = await db.client.findFirst({ where: { name: def.name } });
  if (existing) {
    await db.client.update({
      where: { id: existing.id },
      data: {
        industry: def.industry,
        status: def.status,
        description: def.description,
        website: `https://www.${def.domain}`,
      },
    });
    return { id: existing.id, created: false };
  }
  const created = await db.client.create({
    data: {
      name: def.name,
      industry: def.industry,
      status: def.status,
      description: def.description,
      website: `https://www.${def.domain}`,
    },
  });
  return { id: created.id, created: true };
}

async function upsertClientContact(
  clientId: string,
  domain: string,
  contact: { name: string; title: string; isPrimary?: boolean }
): Promise<boolean> {
  const slug = contact.name.toLowerCase().replace(/[^a-z]+/g, ".").replace(/(^\.|\.$)/g, "");
  const email = `${slug}@${domain}`;
  const existing = await db.clientContact.findFirst({
    where: { clientId, name: contact.name },
  });
  if (existing) {
    await db.clientContact.update({
      where: { id: existing.id },
      data: { title: contact.title, email, isPrimary: contact.isPrimary ?? false },
    });
    return false;
  }
  await db.clientContact.create({
    data: {
      clientId,
      name: contact.name,
      title: contact.title,
      email,
      isPrimary: contact.isPrimary ?? false,
    },
  });
  return true;
}

async function upsertProject(
  def: (typeof PROJECT_DEFS)[number],
  clientId: string,
  parentProjectId?: string
): Promise<{ id: string; created: boolean }> {
  const existing = await db.project.findFirst({ where: { name: def.name, clientId } });
  const startDate = daysFromNow(def.startDays);
  const endDate = daysFromNow(def.endDays);
  if (existing) {
    await db.project.update({
      where: { id: existing.id },
      data: {
        status: def.status,
        startDate,
        endDate,
        parentProjectId: parentProjectId ?? null,
      },
    });
    return { id: existing.id, created: false };
  }
  const created = await db.project.create({
    data: {
      name: def.name,
      clientId,
      status: def.status,
      startDate,
      endDate,
      parentProjectId: parentProjectId ?? null,
      description: `${def.name} — seeded engagement.`,
    },
  });
  return { id: created.id, created: true };
}

async function upsertEmployee(
  def: (typeof NEW_EMPLOYEE_DEFS)[number],
  managerId: string | null
): Promise<{ id: string; created: boolean }> {
  const slug = def.name
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .trim()
    .replace(/\s+/g, ".");
  // example.com is reserved by RFC 2606 for documentation / fixture
  // use; mail to it never reaches a real recipient.
  const email = `${slug}@example.com`;
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    return { id: existing.id, created: false };
  }
  const created = await db.user.create({
    data: {
      name: def.name,
      email,
      jobTitle: def.jobTitle,
      department: def.department,
      role: def.role ?? "CONTRIBUTOR",
      hashedPassword: CANONICAL_PASSWORD_PLACEHOLDER,
      hasLoginAccess: false,
      isActive: true,
      managerId,
    },
  });
  return { id: created.id, created: true };
}

async function upsertSupplier(def: (typeof SUPPLIER_DEFS)[number]): Promise<string> {
  const existing = await db.supplier.findFirst({ where: { name: def.name } });
  const data = {
    name: def.name,
    category: def.category,
    contactName: def.contactName,
    contactEmail: def.contactEmail,
    website: `https://www.${def.domain}`,
    status: "ACTIVE" as const,
  };
  if (existing) {
    await db.supplier.update({ where: { id: existing.id }, data });
    return existing.id;
  }
  const created = await db.supplier.create({ data });
  return created.id;
}

async function upsertSubcontractor(
  def: (typeof SUBCONTRACTOR_DEFS)[number]
): Promise<string> {
  const existing = await db.subcontractor.findFirst({ where: { name: def.name } });
  const data = {
    name: def.name,
    type: def.type,
    status: "ACTIVE" as const,
    specialties: def.specialties,
    primaryContactName: def.primaryContactName,
    primaryContactEmail: def.primaryContactEmail,
    complianceStatus: "COMPLIANT" as const,
  };
  if (existing) {
    await db.subcontractor.update({ where: { id: existing.id }, data });
    return existing.id;
  }
  const created = await db.subcontractor.create({ data });
  return created.id;
}

async function upsertPartnership(def: (typeof PARTNERSHIP_DEFS)[number]): Promise<string> {
  const existing = await db.partnership.findFirst({ where: { name: def.name } });
  const data = {
    name: def.name,
    type: def.type,
    tier: def.tier,
    industry: def.industry,
    status: "ACTIVE" as const,
    primaryContactEmail: def.contacts[0] ? `${def.contacts[0].name.toLowerCase().replace(/[^a-z]+/g, ".")}@${def.domain}` : null,
    primaryContactName: def.contacts[0]?.name ?? null,
    website: `https://www.${def.domain}`,
  };
  if (existing) {
    await db.partnership.update({ where: { id: existing.id }, data });
    return existing.id;
  }
  const created = await db.partnership.create({ data });
  return created.id;
}

async function seedRealistic(): Promise<SeedCounts> {
  console.log("\n[5/5] Seeding realistic dataset...");

  const counts: SeedCounts = {
    clients: 0,
    clientContacts: 0,
    projects: 0,
    projectMembers: 0,
    tasks: 0,
    employees: 0,
    suppliers: 0,
    supplierProjects: 0,
    subcontractors: 0,
    subcontractorContacts: 0,
    partnerships: 0,
    partnershipContacts: 0,
    contracts: 0,
    quotes: 0,
    certifications: 0,
    tools: 0,
    intranetArticles: 0,
    workflowTemplates: 0,
    activityLogs: 0,
    notifications: 0,
    importLogs: 0,
  };

  // Need a creator User for nullable-but-required attribution fields
  // (createdById on tasks, quotes, workflow templates, etc). Pick first
  // active admin; fall back to first active user.
  const creator =
    (await db.user.findFirst({ where: { role: "ADMIN", isActive: true } })) ??
    (await db.user.findFirst({ where: { isActive: true } }));
  if (!creator) throw new Error("seed-realistic: no active user to attribute creator-side records to");

  // ─── Clients + contacts ──────────────────────────────────────
  const clientIdsByName = new Map<string, string>();
  for (const def of CLIENT_DEFS) {
    const { id, created } = await upsertClient(def);
    clientIdsByName.set(def.name, id);
    if (created) counts.clients++;
    for (const contact of def.contacts) {
      const isNew = await upsertClientContact(id, def.domain, contact);
      if (isNew) counts.clientContacts++;
    }
  }

  // ─── New employees with manager hierarchy ────────────────────
  // Two-pass: pass 1 creates everyone with managerId=null; pass 2 wires
  // managerId once all rows exist, so forward references resolve.
  const employeeIdsByName = new Map<string, string>();
  for (const def of NEW_EMPLOYEE_DEFS) {
    const { id, created } = await upsertEmployee(def, null);
    employeeIdsByName.set(def.name, id);
    if (created) counts.employees++;
  }
  for (const def of NEW_EMPLOYEE_DEFS) {
    if (!def.managerName) continue;
    const userId = employeeIdsByName.get(def.name);
    const managerId = employeeIdsByName.get(def.managerName);
    if (!userId || !managerId) continue;
    await db.user.update({ where: { id: userId }, data: { managerId } });
  }

  // Pool of users available for ProjectMember + task assignment.
  // Mix newly seeded + any existing active user (e.g. the admin).
  const allActiveUsers = await db.user.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });

  // ─── Projects (parent-first, then children) ──────────────────
  const projectIdsByName = new Map<string, string>();
  // First pass: parent projects (no childOf)
  for (const def of PROJECT_DEFS) {
    if (def.childOf) continue;
    const clientId = clientIdsByName.get(def.clientName);
    if (!clientId) continue;
    const { id, created } = await upsertProject(def, clientId);
    projectIdsByName.set(def.name, id);
    if (created) counts.projects++;
  }
  // Second pass: subprojects (parentProjectId set)
  for (const def of PROJECT_DEFS) {
    if (!def.childOf) continue;
    const clientId = clientIdsByName.get(def.clientName);
    if (!clientId) continue;
    const parentId = projectIdsByName.get(def.childOf);
    const { id, created } = await upsertProject(def, clientId, parentId);
    projectIdsByName.set(def.name, id);
    if (created) counts.projects++;
  }

  // ─── ProjectMembers (3-7 per project) ────────────────────────
  for (const [projectName, projectId] of Array.from(projectIdsByName.entries())) {
    const r = seedRandom(`members:${projectName}`);
    const memberCount = 3 + Math.floor(r * 5); // 3..7
    const shuffled = [...allActiveUsers].sort(
      (a, b) => seedRandom(`shuf:${projectName}:${a.id}`) - seedRandom(`shuf:${projectName}:${b.id}`)
    );
    const picks = shuffled.slice(0, memberCount);
    for (const user of picks) {
      try {
        await db.projectMember.upsert({
          where: { userId_projectId: { userId: user.id, projectId } },
          update: {},
          create: { userId: user.id, projectId, role: "CONTRIBUTOR" },
        });
        counts.projectMembers++;
      } catch {
        // tolerate races / concurrent runs
      }
    }
  }

  // ─── Tasks (40 across projects) ───────────────────────────────
  const projectNames = Array.from(projectIdsByName.keys());
  const taskTemplates: { title: string; status: "TODO" | "IN_PROGRESS" | "DONE"; priority: "HIGH" | "MEDIUM" | "LOW"; dueOffset: number }[] = [
    { title: "Kickoff meeting agenda", status: "DONE", priority: "MEDIUM", dueOffset: -25 },
    { title: "Stakeholder interviews — round 1", status: "DONE", priority: "MEDIUM", dueOffset: -20 },
    { title: "Discovery doc — first draft", status: "IN_PROGRESS", priority: "HIGH", dueOffset: 5 },
    { title: "Architecture sketch review", status: "TODO", priority: "MEDIUM", dueOffset: 12 },
    { title: "Risk register update", status: "TODO", priority: "MEDIUM", dueOffset: 18 },
    { title: "Vendor RFI sent", status: "DONE", priority: "MEDIUM", dueOffset: -8 },
    { title: "Budget review v2", status: "IN_PROGRESS", priority: "HIGH", dueOffset: 3 },
    { title: "Compliance walk-through", status: "TODO", priority: "HIGH", dueOffset: 21 },
    { title: "Status report for leadership", status: "TODO", priority: "LOW", dueOffset: 7 },
    { title: "Test plan documentation", status: "TODO", priority: "MEDIUM", dueOffset: 30 },
    { title: "Onboarding doc for new hires", status: "TODO", priority: "LOW", dueOffset: 60 },
    { title: "Cutover rehearsal", status: "TODO", priority: "HIGH", dueOffset: 45 },
    { title: "Backup and recovery drill", status: "TODO", priority: "MEDIUM", dueOffset: 50 },
    { title: "Quarterly steering committee prep", status: "TODO", priority: "MEDIUM", dueOffset: 14 },
    { title: "Vendor selection recommendation", status: "TODO", priority: "HIGH", dueOffset: 28 },
    { title: "Update project tracker", status: "DONE", priority: "LOW", dueOffset: -3 },
    { title: "Write postmortem of last sprint", status: "DONE", priority: "MEDIUM", dueOffset: -10 },
    { title: "Dry run for cutover meeting", status: "TODO", priority: "HIGH", dueOffset: 35 },
    { title: "Customer feedback synthesis", status: "IN_PROGRESS", priority: "MEDIUM", dueOffset: 9 },
    { title: "Followup on legal review items", status: "TODO", priority: "MEDIUM", dueOffset: 6 },
  ];
  // 40 tasks total — round-robin templates × projects.
  const taskTotal = 40;
  for (let i = 0; i < taskTotal; i++) {
    const tmpl = taskTemplates[i % taskTemplates.length];
    const projectName = projectNames[i % projectNames.length];
    const projectId = projectIdsByName.get(projectName);
    if (!projectId) continue;
    const titleVariant = `${tmpl.title} — ${projectName}`;
    const existing = await db.task.findFirst({ where: { title: titleVariant, projectId } });
    if (existing) continue;
    const r = seedRandom(`task:${titleVariant}`);
    const assigneeUser = r < 0.3 ? allActiveUsers[Math.floor(r * 1000) % allActiveUsers.length] : null;
    await db.task.create({
      data: {
        title: titleVariant,
        description: `Auto-seeded task for ${projectName}.`,
        status: tmpl.status,
        priority: tmpl.priority,
        projectId,
        assigneeId: assigneeUser?.id ?? null,
        createdById: creator.id,
        dueDate: daysFromNow(tmpl.dueOffset),
        completedAt: tmpl.status === "DONE" ? daysFromNow(tmpl.dueOffset - 1) : null,
      },
    });
    counts.tasks++;
  }

  // ─── Suppliers + SupplierProject links ───────────────────────
  const supplierIdsByName = new Map<string, string>();
  for (const def of SUPPLIER_DEFS) {
    const id = await upsertSupplier(def);
    supplierIdsByName.set(def.name, id);
    counts.suppliers++;
  }
  // 1-3 supplier-project links per supplier.
  for (const [supplierName, supplierId] of Array.from(supplierIdsByName.entries())) {
    const r = seedRandom(`splinks:${supplierName}`);
    const linkCount = 1 + Math.floor(r * 3);
    const shuffled = [...projectNames].sort(
      (a, b) => seedRandom(`spshuf:${supplierName}:${a}`) - seedRandom(`spshuf:${supplierName}:${b}`)
    );
    for (const projectName of shuffled.slice(0, linkCount)) {
      const projectId = projectIdsByName.get(projectName);
      if (!projectId) continue;
      try {
        await db.supplierProject.upsert({
          where: { supplierId_projectId: { supplierId, projectId } },
          update: {},
          create: { supplierId, projectId, notes: "Auto-seeded link." },
        });
        counts.supplierProjects++;
      } catch {
        // tolerate races
      }
    }
  }

  // ─── Subcontractors + contacts ────────────────────────────────
  for (const def of SUBCONTRACTOR_DEFS) {
    const id = await upsertSubcontractor(def);
    counts.subcontractors++;
    const existingContact = await db.subcontractorContact.findFirst({
      where: { subcontractorId: id, name: def.primaryContactName },
    });
    if (!existingContact) {
      await db.subcontractorContact.create({
        data: {
          subcontractorId: id,
          name: def.primaryContactName,
          email: def.primaryContactEmail,
          isPrimary: true,
        },
      });
      counts.subcontractorContacts++;
    }
  }

  // ─── Partnerships + contacts ──────────────────────────────────
  for (const def of PARTNERSHIP_DEFS) {
    const partnershipId = await upsertPartnership(def);
    counts.partnerships++;
    for (const c of def.contacts) {
      const slug = c.name.toLowerCase().replace(/[^a-z]+/g, ".").replace(/(^\.|\.$)/g, "");
      const email = `${slug}@${def.domain}`;
      const existing = await db.partnershipContact.findFirst({
        where: { partnershipId, name: c.name },
      });
      if (existing) continue;
      await db.partnershipContact.create({
        data: {
          partnershipId,
          name: c.name,
          title: c.title,
          email,
          isPrimary: c === def.contacts[0],
        },
      });
      counts.partnershipContacts++;
    }
  }

  // ─── Contracts ────────────────────────────────────────────────
  for (const def of CONTRACT_DEFS) {
    const clientId = clientIdsByName.get(def.clientName);
    if (!clientId) continue;
    const projectId = def.projectName ? projectIdsByName.get(def.projectName) : null;
    const existing = await db.contract.findFirst({ where: { title: def.title, clientId } });
    const data = {
      title: def.title,
      contractType: def.type,
      clientId,
      projectId: projectId ?? null,
      startDate: daysFromNow(def.startDays),
      endDate: daysFromNow(def.endDays),
      renewalDate: daysFromNow(def.renewalDays),
      value: def.value ?? null,
      currency: "USD",
      status: "ACTIVE" as const,
      summary: `${def.title} — seeded contract.`,
    };
    if (existing) {
      await db.contract.update({ where: { id: existing.id }, data });
      continue;
    }
    await db.contract.create({ data });
    counts.contracts++;
  }

  // ─── Quotes ───────────────────────────────────────────────────
  for (const def of QUOTE_DEFS) {
    const clientId = clientIdsByName.get(def.clientName);
    if (!clientId) continue;
    const projectId = def.projectName ? projectIdsByName.get(def.projectName) : null;
    const existing = await db.quote.findFirst({ where: { title: def.title, clientId } });
    if (existing) {
      // Already seeded — refresh status/total but leave quoteNumber stable.
      await db.quote.update({
        where: { id: existing.id },
        data: {
          status: def.status,
          subtotal: def.total,
          total: def.total,
          projectId: projectId ?? null,
        },
      });
      continue;
    }
    // Inline number-derivation. We don't import the runtime nextQuoteNumber
    // helper because it pulls from `@/lib/db` (a Next-aliased path) which
    // tsx can't resolve in this seed script. Logic mirrors the helper.
    const year = new Date().getUTCFullYear();
    const slugify = (s: string): string =>
      s.toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 12) || "Q";
    const projectSlug = def.projectName ? slugify(def.projectName) : null;
    const clientSlug = slugify(def.clientName);
    const yearPrefix = projectSlug ? `${clientSlug}-${projectSlug}-${year}-` : `${clientSlug}-${year}-`;
    const lastForYear = await db.quote.findFirst({
      where: { quoteNumber: { contains: `-${year}-` } },
      orderBy: { createdAt: "desc" },
    });
    let next = 1;
    if (lastForYear) {
      const m = lastForYear.quoteNumber.match(/-(\d{4,})$/);
      if (m) {
        const parsed = parseInt(m[1], 10);
        if (Number.isFinite(parsed)) next = parsed + 1;
      }
    }
    const quoteNumber = `${yearPrefix}${String(next).padStart(4, "0")}`;
    await db.quote.create({
      data: {
        quoteNumber,
        clientId,
        projectId: projectId ?? null,
        status: def.status,
        title: def.title,
        subtotal: def.total,
        total: def.total,
        currency: "USD",
        createdById: creator.id,
        sentAt: def.status === "SENT" || def.status === "ACCEPTED" || def.status === "REJECTED" ? daysFromNow(-7) : null,
        acceptedAt: def.status === "ACCEPTED" ? daysFromNow(-3) : null,
        rejectedAt: def.status === "REJECTED" ? daysFromNow(-2) : null,
      },
    });
    counts.quotes++;
  }

  // ─── Certifications ───────────────────────────────────────────
  for (const def of CERT_DEFS) {
    const existing = await db.certification.findFirst({ where: { name: def.name } });
    const data = {
      name: def.name,
      type: def.type,
      status: def.status,
      issuingBody: def.issuingBody,
      jurisdictionLevel: def.jurisdictionLevel,
      expirationDate: daysFromNow(def.expirationDays),
      renewalDate: daysFromNow(def.expirationDays - 60),
      currency: "USD",
    };
    if (existing) {
      await db.certification.update({ where: { id: existing.id }, data });
      continue;
    }
    await db.certification.create({ data });
    counts.certifications++;
  }

  // ─── Tools ────────────────────────────────────────────────────
  for (const def of TOOL_DEFS) {
    const existing = await db.tool.findFirst({ where: { name: def.name } });
    const data = {
      name: def.name,
      description: def.description,
      toolUrl: def.toolUrl,
      category: def.category,
      toolType: "external",
      isGlobal: true,
    };
    if (existing) {
      await db.tool.update({ where: { id: existing.id }, data });
      continue;
    }
    await db.tool.create({ data });
    counts.tools++;
  }

  // ─── Intranet ─────────────────────────────────────────────────
  for (const def of INTRANET_DEFS) {
    const existing = await db.intranetResource.findFirst({ where: { title: def.title } });
    const data = {
      title: def.title,
      category: def.category,
      content: def.content,
      published: true,
      pinned: def.pinned ?? false,
    };
    if (existing) {
      await db.intranetResource.update({ where: { id: existing.id }, data });
      continue;
    }
    await db.intranetResource.create({ data });
    counts.intranetArticles++;
  }

  // ─── Workflow templates ───────────────────────────────────────
  const workflowTemplateNames = [
    "Realistic Onboarding (Seed)",
    "Realistic Offboarding (Seed)",
    "Quarterly Review (Seed)",
    "Project Kickoff (Seed)",
    "Renewal Reminder (Seed)",
  ];
  for (const name of workflowTemplateNames) {
    const existing = await db.workflowTemplate.findFirst({ where: { name } });
    const baseData: Prisma.WorkflowTemplateCreateInput = {
      name,
      description: `${name} — illustrative template seeded by seed-realistic.`,
      type: name.includes("Onboarding")
        ? "ONBOARDING"
        : name.includes("Offboarding")
          ? "OFFBOARDING"
          : "CUSTOM",
      subjectEntityType: name.includes("Project") ? "CUSTOM" : "EMPLOYEE",
      isActive: true,
      isSeed: false,
      createdBy: { connect: { id: creator.id } },
    };
    if (existing) continue;
    const tpl = await db.workflowTemplate.create({ data: baseData });
    // Two simple steps so the template renders something useful in the UI.
    await db.workflowStep.createMany({
      data: [
        {
          workflowTemplateId: tpl.id,
          position: 0,
          name: `${name} — kickoff email`,
          stepType: "SEND_EMAIL",
          config: JSON.stringify({ toRecipient: "subject", emailTemplateId: "" }),
          timingType: "ON_ENTRY",
          timingValue: 0,
          isRequired: true,
        },
        {
          workflowTemplateId: tpl.id,
          position: 1,
          name: `${name} — coordinator follow-up`,
          stepType: "ASSIGN_TASK_TO_USER",
          config: JSON.stringify({
            assignee: "manager",
            title: `Follow up on ${name}`,
            description: "Coordinator follow-up.",
            dueOffsetDays: 7,
          }),
          timingType: "DAYS_AFTER_START",
          timingValue: 7,
          isRequired: true,
        },
      ],
    });
    counts.workflowTemplates++;
  }

  // ─── Activity log backdated 0..6 months ─────────────────────
  const actions = ["created", "updated", "commented", "viewed"];
  const entityTypes = ["client", "project", "contract", "quote"];
  const userPool = allActiveUsers;
  for (let i = 0; i < 30; i++) {
    const action = pickFrom(`act:${i}:action`, actions);
    const entityType = pickFrom(`act:${i}:etype`, entityTypes);
    const user = userPool[Math.floor(seedRandom(`act:${i}:user`) * userPool.length)];
    if (!user) break;
    const createdAt = backdateMonths(6, `act:${i}:date`);
    // Find a real entity to point at when possible
    let entityId = "seed-noop";
    if (entityType === "client") {
      const c = Array.from(clientIdsByName.values())[i % clientIdsByName.size];
      if (c) entityId = c;
    } else if (entityType === "project") {
      const p = Array.from(projectIdsByName.values())[i % projectIdsByName.size];
      if (p) entityId = p;
    }
    const dedupeKey = `seed-realistic:${i}:${user.id}`;
    const exists = await db.activityLog.findFirst({ where: { details: dedupeKey } });
    if (exists) continue;
    await db.activityLog.create({
      data: {
        action,
        entityType,
        entityId,
        userId: user.id,
        details: dedupeKey,
        createdAt,
      },
    });
    counts.activityLogs++;
  }

  // ─── Notifications for the admin ─────────────────────────────
  const admin = await db.user.findFirst({ where: { role: "ADMIN", isActive: true } });
  if (admin) {
    const notifs: { type: string; title: string; body: string }[] = [
      { type: "task_overdue", title: "Overdue task: Discovery doc — first draft", body: "This task was due 3 days ago and is still in progress." },
      { type: "contract_renewal", title: "Trailfork MSA renewal in 14 days", body: "The Trailfork — Master Services Agreement renews in 14 days. Confirm renewal terms." },
      { type: "access_request", title: "Access request from Theo Nakashima", body: "Theo has requested edit access to the Compliance module." },
      { type: "cert_expiring", title: "Cert SOC 2 expiring in 30 days", body: "SOC 2 Type II — Org-wide expires in 30 days. Renewal kickoff required." },
      { type: "quote_accepted", title: "Quote accepted: ERP Migration Phase 2", body: "Trailfork accepted the ERP Migration Phase 2 quote." },
    ];
    for (const n of notifs) {
      const dedupeTitle = `[seed] ${n.title}`;
      const existing = await db.notification.findFirst({
        where: { recipientId: admin.id, title: dedupeTitle },
      });
      if (existing) continue;
      await db.notification.create({
        data: {
          recipientId: admin.id,
          type: n.type,
          title: dedupeTitle,
          body: n.body,
          readAt: null,
        },
      });
      counts.notifications++;
    }
  }

  // ─── ImportLog rows ──────────────────────────────────────────
  const importLogDefs: { importerKey: string; filename: string; rowCount: number; imported: number; updated: number; skipped: number; errors?: string }[] = [
    { importerKey: "users", filename: "users-2026-01.csv", rowCount: 24, imported: 22, updated: 0, skipped: 2 },
    { importerKey: "clients", filename: "clients-q1-batch.csv", rowCount: 14, imported: 12, updated: 2, skipped: 0 },
    {
      importerKey: "projects",
      filename: "projects-march-batch.csv",
      rowCount: 18,
      imported: 14,
      updated: 0,
      skipped: 4,
      errors: JSON.stringify([
        { row: 3, message: "Client name 'Lattice Cloud' not found — skipped" },
        { row: 7, message: "Invalid status 'in-progress' (expected ACTIVE/PLANNING/...)" },
        { row: 12, message: "Project name already exists for this client" },
      ]),
    },
    {
      importerKey: "tasks",
      filename: "tasks-bulk-upload.csv",
      rowCount: 50,
      imported: 47,
      updated: 0,
      skipped: 3,
      errors: JSON.stringify([
        { row: 9, message: "Assignee email not found — skipped" },
        { row: 33, message: "Project not found — skipped" },
      ]),
    },
  ];
  for (const def of importLogDefs) {
    const existing = await db.importLog.findFirst({
      where: { importerKey: def.importerKey, filename: def.filename, triggeredBy: creator.id },
    });
    if (existing) continue;
    await db.importLog.create({
      data: {
        importerKey: def.importerKey,
        filename: def.filename,
        rowCount: def.rowCount,
        imported: def.imported,
        updated: def.updated,
        skipped: def.skipped,
        errors: def.errors ?? null,
        triggeredBy: creator.id,
        createdAt: backdateMonths(3, `import:${def.filename}`),
      },
    });
    counts.importLogs++;
  }

  return counts;
}

// ─── Driver ──────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("seed-realistic starting (testing env, idempotent, commits)...");

  // Cleanups + merges run OUTSIDE the seeding "transaction" because
  // executeMerge interleaves its own queries (and Prisma's interactive
  // tx isn't necessary for these fix-up writes — they're either
  // narrow per-row updates or no-ops). Each helper is best-effort.
  await runCleanupDemoData();
  await runCleanupDemoEmployees();
  await runNamedPairMerge();
  await runDedupeOrgChart();

  let counts: SeedCounts;
  try {
    counts = await seedRealistic();
  } catch (err) {
    console.error("seed-realistic: dataset seeding failed", err);
    throw err;
  } finally {
    // Disconnect happens in the outer finally too — leave this no-op
    // here so the catch block above can still report cleanly.
  }

  console.log("\n─── Summary ─────────────────────────────────────");
  console.log(`Seeded ${counts.clients} clients, ${counts.clientContacts} contacts`);
  console.log(`        ${counts.projects} projects, ${counts.projectMembers} project members`);
  console.log(`        ${counts.tasks} tasks`);
  console.log(`        ${counts.employees} new employees`);
  console.log(`        ${counts.suppliers} suppliers, ${counts.supplierProjects} supplier-project links`);
  console.log(`        ${counts.subcontractors} subcontractors (${counts.subcontractorContacts} contacts)`);
  console.log(`        ${counts.partnerships} partnerships (${counts.partnershipContacts} contacts)`);
  console.log(`        ${counts.contracts} contracts, ${counts.quotes} quotes`);
  console.log(`        ${counts.certifications} certifications, ${counts.tools} tools`);
  console.log(`        ${counts.intranetArticles} intranet articles, ${counts.workflowTemplates} workflow templates`);
  console.log(`        ${counts.activityLogs} activity logs, ${counts.notifications} notifications, ${counts.importLogs} import logs`);
  console.log("─────────────────────────────────────────────────");
}

main()
  .catch((err) => {
    console.error("seed-realistic failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
