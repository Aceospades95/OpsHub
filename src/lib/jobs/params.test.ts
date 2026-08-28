import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Prisma before importing the module under test.
vi.mock("@/lib/db", () => ({
  db: {
    jobConfig: { findUnique: vi.fn() },
  },
}));

import { db } from "@/lib/db";
import { getJobParams } from "./params";

const findUnique = db.jobConfig.findUnique as ReturnType<typeof vi.fn>;

const DEFAULTS = { days: 7, enabled: true, mode: "standard" };

function setStoredParams(params: unknown) {
  findUnique.mockResolvedValue({ params });
}

beforeEach(() => {
  vi.clearAllMocks();
  findUnique.mockResolvedValue(null);
});

describe("getJobParams", () => {
  it("returns a fresh copy of the defaults when no config row exists", async () => {
    const result = await getJobParams("job-a", DEFAULTS);
    expect(result).toEqual(DEFAULTS);
    expect(result).not.toBe(DEFAULTS); // caller can mutate safely
    expect(findUnique).toHaveBeenCalledWith({
      where: { jobKey: "job-a" },
      select: { params: true },
    });
  });

  it("returns defaults when the row exists but params is null", async () => {
    setStoredParams(null);
    expect(await getJobParams("job-a", DEFAULTS)).toEqual(DEFAULTS);
  });

  it("returns defaults when params is not a plain object", async () => {
    setStoredParams([1, 2, 3]);
    expect(await getJobParams("job-a", DEFAULTS)).toEqual(DEFAULTS);

    setStoredParams('{"days":30}'); // a JSON string is NOT parsed
    expect(await getJobParams("job-a", DEFAULTS)).toEqual(DEFAULTS);

    setStoredParams(42);
    expect(await getJobParams("job-a", DEFAULTS)).toEqual(DEFAULTS);
  });

  it("uses stored values when their type matches the default's type", async () => {
    setStoredParams({ days: 30, enabled: false, mode: "aggressive" });
    expect(await getJobParams("job-a", DEFAULTS)).toEqual({
      days: 30,
      enabled: false,
      mode: "aggressive",
    });
  });

  it("ignores stored values of the wrong primitive type, key by key", async () => {
    setStoredParams({ days: "30", enabled: 1, mode: false });
    expect(await getJobParams("job-a", DEFAULTS)).toEqual(DEFAULTS);
  });

  it("mixes valid and invalid stored values per key", async () => {
    setStoredParams({ days: 14, enabled: "yes", mode: "quiet" });
    expect(await getJobParams("job-a", DEFAULTS)).toEqual({
      days: 14,
      enabled: true, // wrong type → default
      mode: "quiet",
    });
  });

  it("falls back per key when the stored value is null or missing", async () => {
    setStoredParams({ days: null }); // enabled/mode absent entirely
    expect(await getJobParams("job-a", DEFAULTS)).toEqual(DEFAULTS);
  });

  it("rejects non-finite stored numbers (NaN / Infinity)", async () => {
    setStoredParams({ days: NaN });
    expect((await getJobParams("job-a", DEFAULTS)).days).toBe(7);

    setStoredParams({ days: Infinity });
    expect((await getJobParams("job-a", DEFAULTS)).days).toBe(7);

    setStoredParams({ days: -Infinity });
    expect((await getJobParams("job-a", DEFAULTS)).days).toBe(7);
  });

  it("accepts falsy-but-valid stored values (0, false, empty string)", async () => {
    setStoredParams({ days: 0, enabled: false, mode: "" });
    expect(await getJobParams("job-a", DEFAULTS)).toEqual({
      days: 0,
      enabled: false,
      mode: "",
    });
  });

  it("drops stored keys that don't exist in the defaults", async () => {
    setStoredParams({ days: 14, rogueKey: "surprise", another: 99 });
    const result = await getJobParams("job-a", DEFAULTS);
    expect(result).toEqual({ days: 14, enabled: true, mode: "standard" });
    expect(Object.keys(result).sort()).toEqual(["days", "enabled", "mode"]);
  });

  it("does NOT clamp to a schema min — bounds are the form's job, not the merge's", async () => {
    // JobParamField.min is UI metadata; getJobParams only type-checks.
    setStoredParams({ days: -100 });
    expect((await getJobParams("job-a", DEFAULTS)).days).toBe(-100);
  });

  it("returns defaults when the lookup throws (params are tuning, never availability)", async () => {
    findUnique.mockRejectedValue(new Error("db down"));
    const result = await getJobParams("job-a", DEFAULTS);
    expect(result).toEqual(DEFAULTS);
    expect(result).not.toBe(DEFAULTS);
  });

  it("works with an empty defaults object (nothing to merge)", async () => {
    setStoredParams({ anything: 1 });
    expect(await getJobParams("job-a", {})).toEqual({});
  });
});
