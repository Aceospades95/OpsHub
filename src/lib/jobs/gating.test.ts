import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Prisma before importing the module under test. Gating reads
// JobConfig (cadence override) and JobLog (last completed run).
vi.mock("@/lib/db", () => ({
  db: {
    jobLog: { findFirst: vi.fn() },
    jobConfig: { findUnique: vi.fn() },
  },
}));

import { db } from "@/lib/db";
import {
  CADENCE_OVERRIDES,
  shouldRunDaily,
  shouldRunHourly,
  shouldRunMonthly,
  shouldRunTick,
  shouldRunWeekly,
} from "./gating";

const logFindFirst = db.jobLog.findFirst as ReturnType<typeof vi.fn>;
const configFindUnique = db.jobConfig.findUnique as ReturnType<typeof vi.fn>;

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** A completed-run timestamp `ms` in the past. */
function ranAgo(ms: number) {
  return { startedAt: new Date(Date.now() - ms) };
}

function setCadence(cadence: string | null) {
  configFindUnique.mockResolvedValue(cadence === null ? null : { cadence });
}

beforeEach(() => {
  vi.clearAllMocks();
  configFindUnique.mockResolvedValue(null); // no override row by default
  logFindFirst.mockResolvedValue(null); // no completed run by default
});

describe("CADENCE_OVERRIDES", () => {
  it("exposes the admin-selectable cadence set", () => {
    expect(CADENCE_OVERRIDES).toEqual([
      "HOURLY",
      "DAILY",
      "WEEKLY",
      "MONTHLY",
      "DISABLED",
    ]);
  });
});

describe("shouldRunDaily", () => {
  it("returns true when the job has never completed", async () => {
    expect(await shouldRunDaily("digest")).toBe(true);
    // only completed runs count toward the gate
    expect(logFindFirst).toHaveBeenCalledWith({
      where: { jobKey: "digest", status: "completed" },
      orderBy: { startedAt: "desc" },
      select: { startedAt: true },
    });
  });

  it("returns false when a run completed within the 23h window", async () => {
    logFindFirst.mockResolvedValue(ranAgo(2 * HOUR));
    expect(await shouldRunDaily("digest")).toBe(false);
  });

  it("returns false just inside the window (22h ago)", async () => {
    logFindFirst.mockResolvedValue(ranAgo(22 * HOUR));
    expect(await shouldRunDaily("digest")).toBe(false);
  });

  it("returns true once the last completed run is 23h+ old", async () => {
    logFindFirst.mockResolvedValue(ranAgo(23 * HOUR + MIN));
    expect(await shouldRunDaily("digest")).toBe(true);
  });

  it("returns true for yesterday's run (24h ago)", async () => {
    logFindFirst.mockResolvedValue(ranAgo(24 * HOUR));
    expect(await shouldRunDaily("digest")).toBe(true);
  });

  it("returns false for a DISABLED cadence override without reading JobLog", async () => {
    setCadence("DISABLED");
    expect(await shouldRunDaily("digest")).toBe(false);
    expect(logFindFirst).not.toHaveBeenCalled();
  });

  it("honors an HOURLY override (55min window) on a daily job", async () => {
    setCadence("HOURLY");
    logFindFirst.mockResolvedValue(ranAgo(30 * MIN));
    expect(await shouldRunDaily("digest")).toBe(false);

    logFindFirst.mockResolvedValue(ranAgo(56 * MIN));
    expect(await shouldRunDaily("digest")).toBe(true);
  });

  it("honors a WEEKLY override (6d window) on a daily job", async () => {
    setCadence("WEEKLY");
    logFindFirst.mockResolvedValue(ranAgo(2 * DAY));
    expect(await shouldRunDaily("digest")).toBe(false);

    logFindFirst.mockResolvedValue(ranAgo(6 * DAY + HOUR));
    expect(await shouldRunDaily("digest")).toBe(true);
  });

  it("ignores an unrecognized cadence string and falls back to DAILY", async () => {
    setCadence("FORTNIGHTLY");
    logFindFirst.mockResolvedValue(ranAgo(2 * HOUR));
    expect(await shouldRunDaily("digest")).toBe(false);

    logFindFirst.mockResolvedValue(ranAgo(24 * HOUR));
    expect(await shouldRunDaily("digest")).toBe(true);
  });

  it("falls back to the default cadence when the JobConfig lookup throws", async () => {
    configFindUnique.mockRejectedValue(new Error("db down"));
    logFindFirst.mockResolvedValue(ranAgo(24 * HOUR));
    expect(await shouldRunDaily("digest")).toBe(true);

    logFindFirst.mockResolvedValue(ranAgo(HOUR));
    expect(await shouldRunDaily("digest")).toBe(false);
  });
});

describe("shouldRunWeekly", () => {
  it("gates on a 6-day window", async () => {
    logFindFirst.mockResolvedValue(ranAgo(5 * DAY));
    expect(await shouldRunWeekly("weekly-job")).toBe(false);

    logFindFirst.mockResolvedValue(ranAgo(6 * DAY + 2 * HOUR));
    expect(await shouldRunWeekly("weekly-job")).toBe(true);
  });

  it("returns true with no completed history", async () => {
    expect(await shouldRunWeekly("weekly-job")).toBe(true);
  });
});

describe("shouldRunMonthly", () => {
  it("gates on a 28-day window", async () => {
    logFindFirst.mockResolvedValue(ranAgo(27 * DAY));
    expect(await shouldRunMonthly("monthly-job")).toBe(false);

    logFindFirst.mockResolvedValue(ranAgo(29 * DAY));
    expect(await shouldRunMonthly("monthly-job")).toBe(true);
  });
});

describe("shouldRunHourly", () => {
  it("gates on a 55-minute window", async () => {
    logFindFirst.mockResolvedValue(ranAgo(30 * MIN));
    expect(await shouldRunHourly("hourly-job")).toBe(false);

    logFindFirst.mockResolvedValue(ranAgo(HOUR));
    expect(await shouldRunHourly("hourly-job")).toBe(true);
  });

  it("returns true with no completed history", async () => {
    expect(await shouldRunHourly("hourly-job")).toBe(true);
  });

  it("returns false when overridden to DISABLED", async () => {
    setCadence("DISABLED");
    expect(await shouldRunHourly("hourly-job")).toBe(false);
  });
});

describe("shouldRunTick", () => {
  it("returns true with no JobConfig row — the dedicated cron cadence is untouched", async () => {
    expect(await shouldRunTick("engine-tick")).toBe(true);
    expect(logFindFirst).not.toHaveBeenCalled();
  });

  it("returns true when the row exists but cadence is null", async () => {
    setCadence(null);
    configFindUnique.mockResolvedValue({ cadence: null });
    expect(await shouldRunTick("engine-tick")).toBe(true);
    expect(logFindFirst).not.toHaveBeenCalled();
  });

  it("returns true for an unrecognized cadence value", async () => {
    setCadence("SOMETIMES");
    expect(await shouldRunTick("engine-tick")).toBe(true);
    expect(logFindFirst).not.toHaveBeenCalled();
  });

  it("returns false when overridden to DISABLED", async () => {
    setCadence("DISABLED");
    expect(await shouldRunTick("engine-tick")).toBe(false);
    expect(logFindFirst).not.toHaveBeenCalled();
  });

  it("applies an HOURLY override window to a tick job", async () => {
    setCadence("HOURLY");
    logFindFirst.mockResolvedValue(ranAgo(10 * MIN));
    expect(await shouldRunTick("engine-tick")).toBe(false);

    logFindFirst.mockResolvedValue(ranAgo(HOUR));
    expect(await shouldRunTick("engine-tick")).toBe(true);
  });

  it("returns true under an override when the job has never completed", async () => {
    setCadence("HOURLY");
    logFindFirst.mockResolvedValue(null);
    expect(await shouldRunTick("engine-tick")).toBe(true);
  });

  it("applies a DAILY override window to a tick job", async () => {
    setCadence("DAILY");
    logFindFirst.mockResolvedValue(ranAgo(2 * HOUR));
    expect(await shouldRunTick("engine-tick")).toBe(false);

    logFindFirst.mockResolvedValue(ranAgo(24 * HOUR));
    expect(await shouldRunTick("engine-tick")).toBe(true);
  });

  it("fails open (true) when the JobConfig lookup throws", async () => {
    configFindUnique.mockRejectedValue(new Error("db down"));
    expect(await shouldRunTick("engine-tick")).toBe(true);
  });
});
