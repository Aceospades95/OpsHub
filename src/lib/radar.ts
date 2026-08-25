import { addDays } from "date-fns";
import { db } from "@/lib/db";
import type { UserScope } from "@/lib/scope";
import {
  maintenanceDueState,
  registrationDueState,
  vehicleScheduleSummary,
  vehicleLabel,
} from "@/lib/fleet";
import { PRE_SUBMISSION_STATUSES } from "@/lib/bids";

/**
 * Renewal Radar — "what falls over in the next N days" across every
 * module that carries a hard date: contract ends/renewals, certification
 * expirations, subcontractor insurance, partnership agreements, fleet
 * service + registration, and bid deadlines.
 *
 * Two halves:
 *   - Pure date-window helpers (top of file, no I/O) — covered by
 *     radar.test.ts.
 *   - getRadarData() — the one batched Promise.all behind /radar and
 *     the dashboard's radar summary card.
 *
 * Read-only by design: nothing in here mutates.
 */

// ─── Pure date-window helpers ─────────────────────────────────────

/** Selectable look-ahead windows for /radar?days=. */
export const RADAR_WINDOWS = [30, 60, 90, 180] as const;
export type RadarWindow = (typeof RADAR_WINDOWS)[number];
export const DEFAULT_RADAR_WINDOW: RadarWindow = 90;

/**
 * Parse the ?days= param. Anything that isn't exactly one of
 * RADAR_WINDOWS (missing, junk, negative, 91) falls back to the
 * default 90 — the window is a fixed set of toggles, not free-form.
 */
export function resolveRadarWindow(
  param: string | string[] | undefined
): RadarWindow {
  const raw = Array.isArray(param) ? param[0] : param;
  if (!raw) return DEFAULT_RADAR_WINDOW;
  const n = Number(raw);
  return RADAR_WINDOWS.find((w) => w === n) ?? DEFAULT_RADAR_WINDOW;
}

const MS_PER_DAY = 86_400_000;

/** Days-since-epoch of the UTC calendar day containing `d`. */
function utcDayIndex(d: Date): number {
  return Math.floor(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / MS_PER_DAY
  );
}

/**
 * Whole calendar days from `now` until `target`, on UTC day boundaries.
 *
 * Calendar-date columns in this codebase are stored as UTC midnight
 * (see lib/dates.ts), and formatCalendarDate renders them in UTC — so
 * days-remaining math must use the same UTC-day framing or the badge
 * ("in 1d") and the printed date could disagree near midnight.
 *
 *   target is today       →  0
 *   target is tomorrow    →  1
 *   target was yesterday  → -1
 */
export function daysUntil(target: Date, now: Date): number {
  return utcDayIndex(target) - utcDayIndex(now);
}

/**
 * Query horizon for a window: rows qualify when their date column is
 * `<= radarHorizon(now, windowDays)` (past dates included — overdue is
 * radar signal, not noise). For UTC-midnight-stored calendar dates this
 * is exactly equivalent to `daysUntil(date, now) <= windowDays`, so the
 * SQL filter and the rendered days-remaining always agree.
 */
export function radarHorizon(now: Date, windowDays: number): Date {
  return addDays(now, windowDays);
}

/** Amber threshold for the days-remaining badge. */
export const DUE_SOON_DAYS = 14;

export type DueTone = "overdue" | "soon" | "ok";

/** Badge tone: red when past, amber within `soonDays`, muted otherwise. */
export function dueTone(
  daysRemaining: number,
  soonDays: number = DUE_SOON_DAYS
): DueTone {
  if (daysRemaining < 0) return "overdue";
  if (daysRemaining <= soonDays) return "soon";
  return "ok";
}

/** "12d overdue" / "today" / "in 5d". */
export function daysRemainingLabel(daysRemaining: number): string {
  if (daysRemaining < 0) return `${-daysRemaining}d overdue`;
  if (daysRemaining === 0) return "today";
  return `in ${daysRemaining}d`;
}

/**
 * A pre-submission bid whose deadline is more than this many days past
 * is probably a dead record, not a live deadline — the pipeline can't
 * tell, so the radar flags it "stale?" instead of screaming overdue.
 */
export const BID_STALE_PAST_DAYS = 30;

export function isStaleBidDeadline(daysRemaining: number): boolean {
  return daysRemaining < -BID_STALE_PAST_DAYS;
}

/**
 * Which contract date drives its radar row: the sooner of endDate /
 * renewalDate among those inside the window (or past). Null when
 * neither qualifies.
 */
export function pickContractRadarDate(
  contract: { endDate: Date | null; renewalDate: Date | null },
  now: Date,
  windowDays: number
): { date: Date; kind: "end" | "renewal"; daysRemaining: number } | null {
  const candidates: Array<{ date: Date; kind: "end" | "renewal" }> = [];
  if (contract.endDate) candidates.push({ date: contract.endDate, kind: "end" });
  if (contract.renewalDate)
    candidates.push({ date: contract.renewalDate, kind: "renewal" });

  let best: { date: Date; kind: "end" | "renewal"; daysRemaining: number } | null =
    null;
  for (const c of candidates) {
    const daysRemaining = daysUntil(c.date, now);
    if (daysRemaining > windowDays) continue;
    if (!best || daysRemaining < best.daysRemaining) best = { ...c, daysRemaining };
  }
  return best;
}

// ─── Row shapes ───────────────────────────────────────────────────

export interface ContractRadarRow {
  id: string;
  title: string;
  clientName: string;
  /** Which date put the contract on the radar. */
  kind: "end" | "renewal";
  date: Date;
  daysRemaining: number;
  noticePeriodDays: number | null;
}

export interface CertificationRadarRow {
  id: string;
  name: string;
  clientName: string | null;
  expirationDate: Date;
  daysRemaining: number;
  /** Set when the renewal application is already with the issuing body. */
  renewalSubmittedAt: Date | null;
}

export interface SubcontractorRadarRow {
  id: string;
  name: string;
  status: string;
  insuranceExpiresAt: Date;
  daysRemaining: number;
}

export interface PartnershipRadarRow {
  id: string;
  name: string;
  status: string;
  agreementExpiresAt: Date;
  daysRemaining: number;
  autoRenew: boolean;
}

export interface VehicleRadarRow {
  id: string;
  label: string;
  status: string;
  /** Most urgent due service, when one is due-soon/overdue in-window. */
  service: {
    /** Null on the legacy single-next-service-date path. */
    serviceType: string | null;
    dueDate: Date | null;
    dueMileage: number | null;
    daysRemaining: number | null;
    milesRemaining: number | null;
    overdue: boolean;
    /** >1 when several schedules are overdue at once. */
    overdueCount: number;
  } | null;
  registration: {
    expiresAt: Date;
    daysRemaining: number;
    overdue: boolean;
  } | null;
  /** Soonest applicable days-remaining — drives section sort. */
  sortDays: number;
}

export interface BidRadarRow {
  id: string;
  title: string;
  agency: string | null;
  status: string;
  dueDate: Date;
  daysRemaining: number;
  stale: boolean;
}

/** Data-gap counts; null = the viewer can't see that module at all. */
export interface RadarGaps {
  clientsWithoutAccountManager: number | null;
  projectsWithoutEndDate: number | null;
  projectsWithoutServiceOffering: number | null;
  wonBidsUnlinked: number | null;
  activeSubcontractorsUnassigned: number | null;
}

/** canView per module, resolved by the caller via resolveModulePerms. */
export interface RadarModuleAccess {
  contracts: boolean;
  certifications: boolean;
  subcontractors: boolean;
  partnerships: boolean;
  fleet: boolean;
  bids: boolean;
  clients: boolean;
  projects: boolean;
}

export interface RadarData {
  windowDays: number;
  /** Null section = module not visible to this viewer (vs [] = nothing due). */
  contracts: ContractRadarRow[] | null;
  certifications: {
    due: CertificationRadarRow[];
    /** renewalSubmittedAt set — waiting on the issuing body. */
    inFlight: CertificationRadarRow[];
  } | null;
  subcontractors: SubcontractorRadarRow[] | null;
  partnerships: PartnershipRadarRow[] | null;
  vehicles: VehicleRadarRow[] | null;
  bids: BidRadarRow[] | null;
  gaps: RadarGaps;
}

// ─── Aggregation ──────────────────────────────────────────────────

/** Sentinel sort key for rows overdue by mileage only (no date to count). */
const OVERDUE_NO_DATE_SORT = -100_000;

/**
 * Everything the radar shows, in ONE batched Promise.all.
 *
 * Scope follows /dashboard's idiom: org-wide for scope.all viewers,
 * assigned-entity sets otherwise for the entity-scoped modules
 * (contracts, certifications, fleet, clients, projects). Modules
 * without entity scoping (subcontractors, partnerships, bids) are
 * all-or-nothing on the module canView flag, same as their list pages.
 */
export async function getRadarData(opts: {
  now: Date;
  windowDays: number;
  scope: UserScope;
  access: RadarModuleAccess;
  /** Skip the data-gaps counts (dashboard summary card doesn't show them). */
  includeGaps?: boolean;
}): Promise<RadarData> {
  const { now, windowDays, scope, access } = opts;
  const includeGaps = opts.includeGaps ?? true;
  const horizon = radarHorizon(now, windowDays);

  const contractScope = scope.all ? {} : { id: { in: Array.from(scope.contractIds) } };
  const certScope = scope.all ? {} : { id: { in: Array.from(scope.certIds) } };
  const vehicleScope = scope.all ? {} : { id: { in: Array.from(scope.vehicleIds) } };
  const clientScope = scope.all ? {} : { id: { in: Array.from(scope.clientIds) } };
  const projectScope = scope.all ? {} : { id: { in: Array.from(scope.projectIds) } };

  const [
    contractRows,
    certRows,
    subRows,
    partnershipRows,
    vehicleRows,
    bidRows,
    clientsWithoutAm,
    projectsNoEnd,
    projectsNoOffering,
    wonBidsUnlinked,
    subsUnassigned,
  ] = await Promise.all([
    // 1. Contracts — endDate OR renewalDate inside the window (or past),
    //    live statuses only (EXPIRED/TERMINATED/RENEWED/DRAFT are either
    //    already dealt with or not yet real), soft-deletes excluded.
    access.contracts
      ? db.contract.findMany({
          where: {
            deletedAt: null,
            status: { in: ["ACTIVE", "EXPIRING_SOON", "UNDER_REVIEW"] },
            OR: [{ endDate: { lte: horizon } }, { renewalDate: { lte: horizon } }],
            ...contractScope,
          },
          select: {
            id: true,
            title: true,
            endDate: true,
            renewalDate: true,
            noticePeriodDays: true,
            client: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
    // 2. Certifications — expirationDate inside window/past, stored
    //    status not already EXPIRED (a stale ACTIVE row whose date has
    //    passed is exactly what the radar exists to surface). Rows with
    //    renewalSubmittedAt set are fetched too and split into the muted
    //    "renewal in flight" bucket by the mapper below.
    access.certifications
      ? db.certification.findMany({
          where: {
            deletedAt: null,
            status: { not: "EXPIRED" },
            expirationDate: { lte: horizon },
            ...certScope,
          },
          select: {
            id: true,
            name: true,
            expirationDate: true,
            renewalSubmittedAt: true,
            client: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
    // 3. Subcontractor insurance — insuranceExpiresAt inside window/past.
    //    Per spec no status filter (only soft-deletes excluded); status is
    //    carried on the row so non-active subs are identifiable.
    access.subcontractors
      ? db.subcontractor.findMany({
          where: { deletedAt: null, insuranceExpiresAt: { lte: horizon } },
          select: { id: true, name: true, status: true, insuranceExpiresAt: true },
        })
      : Promise.resolve([]),
    // 4. Partnership agreements — agreementExpiresAt inside window/past.
    access.partnerships
      ? db.partnership.findMany({
          where: { deletedAt: null, agreementExpiresAt: { lte: horizon } },
          select: {
            id: true,
            name: true,
            status: true,
            agreementExpiresAt: true,
            autoRenew: true,
          },
        })
      : Promise.resolve([]),
    // 5. Vehicles — due math (months + mileage bounds) lives in
    //    lib/fleet and can't run in SQL, so fetch every non-retired
    //    vehicle (the /fleet page does the same) and filter in the
    //    mapper. RETIRED/SOLD never nag, mirroring the fleet helpers.
    access.fleet
      ? db.vehicle.findMany({
          where: {
            deletedAt: null,
            status: { notIn: ["RETIRED", "SOLD"] },
            ...vehicleScope,
          },
          select: {
            id: true,
            nickname: true,
            year: true,
            make: true,
            model: true,
            status: true,
            currentMileage: true,
            nextServiceDate: true,
            registrationExpiresAt: true,
            serviceSchedules: {
              select: {
                serviceType: true,
                everyMonths: true,
                everyMiles: true,
                lastServiceDate: true,
                lastServiceMileage: true,
              },
            },
          },
        })
      : Promise.resolve([]),
    // 6. Bid deadlines — dueDate inside window/past, pre-submission
    //    stages only (SUBMITTED bids are with the buyer; closed ones are
    //    history).
    access.bids
      ? db.bidOpportunity.findMany({
          where: {
            deletedAt: null,
            status: { in: [...PRE_SUBMISSION_STATUSES] },
            dueDate: { lte: horizon },
          },
          select: { id: true, title: true, agency: true, status: true, dueDate: true },
        })
      : Promise.resolve([]),
    // ── Data gaps ─────────────────────────────────────────────────
    includeGaps && access.clients
      ? db.client.count({
          where: {
            deletedAt: null,
            status: "ACTIVE",
            accountManagerId: null,
            ...clientScope,
          },
        })
      : Promise.resolve(0),
    includeGaps && access.projects
      ? db.project.count({
          where: {
            deletedAt: null,
            status: { in: ["PLANNING", "ACTIVE"] },
            endDate: null,
            ...projectScope,
          },
        })
      : Promise.resolve(0),
    includeGaps && access.projects
      ? db.project.count({
          where: { deletedAt: null, serviceOfferingId: null, ...projectScope },
        })
      : Promise.resolve(0),
    // contractId is a brand-new column, so most legacy WON bids will
    // trip the OR until they're backfilled — that's the point.
    includeGaps && access.bids
      ? db.bidOpportunity.count({
          where: {
            deletedAt: null,
            status: "WON",
            OR: [{ projectId: null }, { contractId: null }],
          },
        })
      : Promise.resolve(0),
    includeGaps && access.subcontractors
      ? db.subcontractor.count({
          where: { deletedAt: null, status: "ACTIVE", projects: { none: {} } },
        })
      : Promise.resolve(0),
  ]);

  // ── Contracts ───────────────────────────────────────────────────
  const contracts: ContractRadarRow[] | null = access.contracts
    ? contractRows
        .flatMap((c) => {
          const picked = pickContractRadarDate(c, now, windowDays);
          if (!picked) return [];
          return [
            {
              id: c.id,
              title: c.title,
              clientName: c.client.name,
              kind: picked.kind,
              date: picked.date,
              daysRemaining: picked.daysRemaining,
              noticePeriodDays: c.noticePeriodDays,
            },
          ];
        })
        .sort((a, b) => a.daysRemaining - b.daysRemaining)
    : null;

  // ── Certifications ──────────────────────────────────────────────
  const certMapped = access.certifications
    ? certRows
        .filter((c) => c.expirationDate != null)
        .map((c) => ({
          id: c.id,
          name: c.name,
          clientName: c.client?.name ?? null,
          expirationDate: c.expirationDate as Date,
          daysRemaining: daysUntil(c.expirationDate as Date, now),
          renewalSubmittedAt: c.renewalSubmittedAt,
        }))
        .sort((a, b) => a.daysRemaining - b.daysRemaining)
    : null;
  const certifications = certMapped
    ? {
        due: certMapped.filter((c) => c.renewalSubmittedAt == null),
        inFlight: certMapped.filter((c) => c.renewalSubmittedAt != null),
      }
    : null;

  // ── Subcontractor insurance ─────────────────────────────────────
  const subcontractors: SubcontractorRadarRow[] | null = access.subcontractors
    ? subRows
        .filter((s) => s.insuranceExpiresAt != null)
        .map((s) => ({
          id: s.id,
          name: s.name,
          status: s.status,
          insuranceExpiresAt: s.insuranceExpiresAt as Date,
          daysRemaining: daysUntil(s.insuranceExpiresAt as Date, now),
        }))
        .sort((a, b) => a.daysRemaining - b.daysRemaining)
    : null;

  // ── Partnership agreements ──────────────────────────────────────
  const partnerships: PartnershipRadarRow[] | null = access.partnerships
    ? partnershipRows
        .filter((p) => p.agreementExpiresAt != null)
        .map((p) => ({
          id: p.id,
          name: p.name,
          status: p.status,
          agreementExpiresAt: p.agreementExpiresAt as Date,
          daysRemaining: daysUntil(p.agreementExpiresAt as Date, now),
          autoRenew: p.autoRenew,
        }))
        .sort((a, b) => a.daysRemaining - b.daysRemaining)
    : null;

  // ── Vehicles ────────────────────────────────────────────────────
  const vehicles: VehicleRadarRow[] | null = access.fleet
    ? vehicleRows
        .flatMap((v) => {
          // Per-service-type schedules roll up via the fleet helper with
          // the radar window as the due-soon horizon (the helper's
          // 14-day default is the fleet page's own alerting window; the
          // radar's is user-selected). Vehicles without schedules use
          // the legacy single next-service date, whose overdue/none
          // states come from maintenanceDueState — in-window inclusion
          // for that path is the radar's own daysUntil() check because
          // the legacy helper has a fixed 14-day window.
          let service: VehicleRadarRow["service"] = null;
          if (v.serviceSchedules.length > 0) {
            const summary = vehicleScheduleSummary(v.serviceSchedules, v, now, {
              dueSoonDays: windowDays,
            });
            if (
              (summary.status === "overdue" || summary.status === "due-soon") &&
              summary.nextDue
            ) {
              service = {
                serviceType: summary.nextDue.serviceType,
                dueDate: summary.nextDue.state.dueDate,
                dueMileage: summary.nextDue.state.dueMileage,
                daysRemaining: summary.nextDue.state.daysRemaining,
                milesRemaining: summary.nextDue.state.milesRemaining,
                overdue: summary.status === "overdue",
                overdueCount: summary.overdueCount,
              };
            }
          } else if (
            v.nextServiceDate &&
            daysUntil(v.nextServiceDate, now) <= windowDays
          ) {
            const legacy = maintenanceDueState(v, now);
            service = {
              serviceType: null,
              dueDate: v.nextServiceDate,
              dueMileage: null,
              daysRemaining: daysUntil(v.nextServiceDate, now),
              milesRemaining: null,
              overdue: legacy === "overdue",
              overdueCount: legacy === "overdue" ? 1 : 0,
            };
          }

          const reg = registrationDueState(v, now, windowDays);
          const registration =
            (reg.status === "overdue" || reg.status === "due-soon") &&
            v.registrationExpiresAt
              ? {
                  expiresAt: v.registrationExpiresAt,
                  daysRemaining: daysUntil(v.registrationExpiresAt, now),
                  overdue: reg.status === "overdue",
                }
              : null;

          if (!service && !registration) return [];

          const dayCandidates = [
            service?.daysRemaining,
            registration?.daysRemaining,
          ].filter((d): d is number => d != null);
          const sortDays =
            dayCandidates.length > 0
              ? Math.min(...dayCandidates)
              : OVERDUE_NO_DATE_SORT; // overdue by mileage only — sort first
          return [
            {
              id: v.id,
              label: vehicleLabel(v),
              status: v.status,
              service,
              registration,
              sortDays,
            },
          ];
        })
        .sort((a, b) => a.sortDays - b.sortDays)
    : null;

  // ── Bid deadlines ───────────────────────────────────────────────
  const bids: BidRadarRow[] | null = access.bids
    ? bidRows
        .filter((b) => b.dueDate != null)
        .map((b) => {
          const daysRemaining = daysUntil(b.dueDate as Date, now);
          return {
            id: b.id,
            title: b.title,
            agency: b.agency,
            status: b.status,
            dueDate: b.dueDate as Date,
            daysRemaining,
            stale: isStaleBidDeadline(daysRemaining),
          };
        })
        .sort((a, b) => a.daysRemaining - b.daysRemaining)
    : null;

  return {
    windowDays,
    contracts,
    certifications,
    subcontractors,
    partnerships,
    vehicles,
    bids,
    gaps: {
      clientsWithoutAccountManager:
        includeGaps && access.clients ? clientsWithoutAm : null,
      projectsWithoutEndDate:
        includeGaps && access.projects ? projectsNoEnd : null,
      projectsWithoutServiceOffering:
        includeGaps && access.projects ? projectsNoOffering : null,
      wonBidsUnlinked: includeGaps && access.bids ? wonBidsUnlinked : null,
      activeSubcontractorsUnassigned:
        includeGaps && access.subcontractors ? subsUnassigned : null,
    },
  };
}

// ─── Dashboard summary ────────────────────────────────────────────

export interface RadarSummaryItem {
  title: string;
  href: string;
  /** Null for a vehicle overdue by mileage only — no day count exists. */
  daysRemaining: number | null;
}

/**
 * Roll RadarData up for the dashboard card: total items due across the
 * sections plus the soonest few. Excluded on purpose: certification
 * renewals already in flight (waiting on the issuing body, not falling
 * over) and stale bid deadlines (>30d past — probably dead records, and
 * they'd otherwise hog the "soonest" slots with huge negative numbers).
 */
export function summarizeRadar(
  data: RadarData,
  soonestCount = 3
): { total: number; soonest: RadarSummaryItem[] } {
  const items: RadarSummaryItem[] = [];

  for (const c of data.contracts ?? []) {
    items.push({ title: c.title, href: `/contracts/${c.id}`, daysRemaining: c.daysRemaining });
  }
  for (const c of data.certifications?.due ?? []) {
    items.push({ title: c.name, href: `/certifications/${c.id}`, daysRemaining: c.daysRemaining });
  }
  for (const s of data.subcontractors ?? []) {
    items.push({
      title: `${s.name} insurance`,
      href: `/subcontractors/${s.id}`,
      daysRemaining: s.daysRemaining,
    });
  }
  for (const p of data.partnerships ?? []) {
    items.push({
      title: `${p.name} agreement`,
      href: `/partnerships/${p.id}`,
      daysRemaining: p.daysRemaining,
    });
  }
  for (const v of data.vehicles ?? []) {
    items.push({
      title: `${v.label} ${v.service ? "service" : "registration"}`,
      href: `/fleet/${v.id}`,
      daysRemaining: v.sortDays === OVERDUE_NO_DATE_SORT ? null : v.sortDays,
    });
  }
  for (const b of data.bids ?? []) {
    if (b.stale) continue;
    items.push({ title: b.title, href: `/bids/${b.id}`, daysRemaining: b.daysRemaining });
  }

  // Mileage-only overdue (null days) sorts first — it's already due.
  items.sort(
    (a, b) =>
      (a.daysRemaining ?? OVERDUE_NO_DATE_SORT) -
      (b.daysRemaining ?? OVERDUE_NO_DATE_SORT)
  );
  return { total: items.length, soonest: items.slice(0, soonestCount) };
}
