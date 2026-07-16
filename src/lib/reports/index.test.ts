import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// Mock Prisma (for the override lookup inside getReportOverride) and the
// registry (so runReport executes a fake report instead of a real query).
// Both mocks must precede the import of the module under test.
vi.mock("@/lib/db", () => ({
  db: {
    reportOverride: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));
vi.mock("@/lib/log", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("./registry", () => ({
  getReport: vi.fn(),
  listReports: vi.fn(() => []),
  listSchedulableReports: vi.fn(() => []),
  REPORTS: [],
}));

import { db } from "@/lib/db";
import { getReport } from "./registry";
import { runReport } from "./index";
import type { ReportContext, ReportDefinition, ReportOutput } from "./types";

const findUnique = db.reportOverride.findUnique as ReturnType<typeof vi.fn>;
const getReportMock = getReport as ReturnType<typeof vi.fn>;

const CTX = { triggeredAt: new Date("2026-07-16T08:00:00Z"), triggeredBy: "u1" };

function fakeOutput(): ReportOutput {
  return {
    summary: "2 rows",
    columns: [
      { key: "name", label: "Name" },
      { key: "count", label: "Count" },
    ],
    rows: [
      { name: "First", count: 1 },
      { name: "Second", count: 2 },
    ],
  };
}

let runSpy: Mock<(ctx: ReportContext) => Promise<ReportOutput>>;
let fakeReport: ReportDefinition;

beforeEach(() => {
  vi.clearAllMocks();
  runSpy = vi.fn(async (_ctx: ReportContext) => fakeOutput());
  fakeReport = {
    key: "fake-report",
    name: "Stock Name",
    description: "Stock description",
    module: "testing",
    run: runSpy,
  };
  getReportMock.mockImplementation((key: string) =>
    key === "fake-report" ? fakeReport : undefined
  );
  findUnique.mockResolvedValue(null);
});

describe("runReport", () => {
  it("throws for an unknown report key", async () => {
    await expect(runReport("nope", CTX)).rejects.toThrow(
      'Unknown report key: nope'
    );
    expect(runSpy).not.toHaveBeenCalled();
  });

  it("returns stock name/description and stock flags when no override row exists", async () => {
    const result = await runReport("fake-report", CTX);
    expect(runSpy).toHaveBeenCalledWith(CTX);
    expect(result.name).toBe("Stock Name");
    expect(result.description).toBe("Stock description");
    expect(result.stockName).toBe("Stock Name");
    expect(result.stockDescription).toBe("Stock description");
    expect(result.hidden).toBe(false);
    expect(result.overridden).toBe(false);
    expect(result.override).toBeNull();
    expect(result.output).toEqual(fakeOutput());
    expect(result.stockColumns).toEqual([
      { key: "name", label: "Name" },
      { key: "count", label: "Count" },
    ]);
  });

  it("replaces name/description from the override while stock* keeps code values", async () => {
    findUnique.mockResolvedValue({
      reportKey: "fake-report",
      displayName: "Admin Name",
      description: "Admin description",
      hidden: false,
      maxRows: null,
      columnConfig: null,
    });
    const result = await runReport("fake-report", CTX);
    expect(result.name).toBe("Admin Name");
    expect(result.description).toBe("Admin description");
    expect(result.stockName).toBe("Stock Name");
    expect(result.stockDescription).toBe("Stock description");
    expect(result.overridden).toBe(true);
    expect(result.override?.displayName).toBe("Admin Name");
  });

  it("falls back to stock name/description for empty-string override values", async () => {
    findUnique.mockResolvedValue({
      reportKey: "fake-report",
      displayName: "",
      description: "",
      hidden: false,
      maxRows: null,
      columnConfig: null,
    });
    const result = await runReport("fake-report", CTX);
    expect(result.name).toBe("Stock Name");
    expect(result.description).toBe("Stock description");
    // it's still an override row, so overridden stays true
    expect(result.overridden).toBe(true);
  });

  it("marks hidden reports as hidden but still produces output", async () => {
    findUnique.mockResolvedValue({
      reportKey: "fake-report",
      displayName: null,
      description: null,
      hidden: true,
      maxRows: null,
      columnConfig: null,
    });
    const result = await runReport("fake-report", CTX);
    expect(result.hidden).toBe(true);
    expect(runSpy).toHaveBeenCalledOnce();
    expect(result.output.rows).toHaveLength(2);
    expect(result.name).toBe("Stock Name");
  });

  it("applies columnConfig to the output while stockColumns keeps the untouched shape", async () => {
    findUnique.mockResolvedValue({
      reportKey: "fake-report",
      displayName: null,
      description: null,
      hidden: false,
      maxRows: null,
      columnConfig: { count: { hidden: true }, name: { label: "Who" } },
    });
    const result = await runReport("fake-report", CTX);
    expect(result.output.columns).toEqual([{ key: "name", label: "Who" }]);
    expect(result.output.rows).toEqual([{ name: "First" }, { name: "Second" }]);
    // stockColumns captured from the raw run, before the override
    expect(result.stockColumns).toEqual([
      { key: "name", label: "Name" },
      { key: "count", label: "Count" },
    ]);
  });

  it("applies maxRows truncation through the runReport choke point", async () => {
    findUnique.mockResolvedValue({
      reportKey: "fake-report",
      displayName: null,
      description: null,
      hidden: false,
      maxRows: 1,
      columnConfig: null,
    });
    const result = await runReport("fake-report", CTX);
    expect(result.output.rows).toEqual([{ name: "First", count: 1 }]);
    expect(result.output.summary).toBe(
      "2 rows · showing first 1 of 2 rows (display cap)"
    );
  });

  it("treats an override-lookup failure as stock behavior (overrides never take reports down)", async () => {
    findUnique.mockRejectedValue(new Error("db down"));
    const result = await runReport("fake-report", CTX);
    expect(result.overridden).toBe(false);
    expect(result.name).toBe("Stock Name");
    expect(result.output.rows).toHaveLength(2);
  });
});
