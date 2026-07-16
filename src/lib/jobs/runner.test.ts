import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// Mock Prisma, notifications, the logger, and the job registry before
// importing the runner so its static imports pick up the mocks. The
// registry mock lets each test install a controlled fake job.
vi.mock("@/lib/db", () => ({
  db: {
    jobLog: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    jobConfig: {
      findUnique: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
  },
}));
vi.mock("@/lib/notifications", () => ({
  notify: vi.fn(),
}));
vi.mock("@/lib/log", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("./registry", () => ({
  getJob: vi.fn(),
  listJobs: vi.fn(() => []),
}));

import { db } from "@/lib/db";
import { notify } from "@/lib/notifications";
import { log } from "@/lib/log";
import { getJob, listJobs } from "./registry";
import { runJob, runAllJobs } from "./runner";
import type { JobContext, JobDefinition, JobResult } from "./types";

const logCreate = db.jobLog.create as ReturnType<typeof vi.fn>;
const logUpdate = db.jobLog.update as ReturnType<typeof vi.fn>;
const logUpdateMany = db.jobLog.updateMany as ReturnType<typeof vi.fn>;
const logFindFirst = db.jobLog.findFirst as ReturnType<typeof vi.fn>;
const logFindMany = db.jobLog.findMany as ReturnType<typeof vi.fn>;
const configFindUnique = db.jobConfig.findUnique as ReturnType<typeof vi.fn>;
const userFindMany = db.user.findMany as ReturnType<typeof vi.fn>;
const notifyMock = notify as ReturnType<typeof vi.fn>;
const getJobMock = getJob as ReturnType<typeof vi.fn>;
const listJobsMock = listJobs as ReturnType<typeof vi.fn>;

let handler: Mock<(ctx: JobContext) => Promise<JobResult>>;
let job: JobDefinition;

function installJob(overrides: Partial<JobDefinition> = {}) {
  job = {
    key: "test-job",
    name: "Test Job",
    description: "A job for tests",
    schedule: "Daily",
    handler,
    ...overrides,
  };
  getJobMock.mockImplementation((key: string) =>
    key === job.key ? job : undefined
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  handler = vi.fn(async (_ctx: JobContext): Promise<JobResult> => ({
    output: "did work",
    processed: 5,
  }));
  installJob();
  // Healthy-path defaults: no config row, nothing running, nothing reaped.
  configFindUnique.mockResolvedValue(null);
  logUpdateMany.mockResolvedValue({ count: 0 });
  logFindFirst.mockResolvedValue(null);
  logCreate.mockResolvedValue({ id: "log-1" });
  logUpdate.mockResolvedValue({});
  logFindMany.mockResolvedValue([]);
  userFindMany.mockResolvedValue([]);
  notifyMock.mockResolvedValue(undefined);
});

describe("runJob — basic statuses", () => {
  it("returns 'unknown' for an unregistered key without touching the db", async () => {
    const result = await runJob("nope", "cron");
    expect(result).toEqual({
      status: "unknown",
      error: 'No job registered with key "nope"',
    });
    expect(logCreate).not.toHaveBeenCalled();
    expect(configFindUnique).not.toHaveBeenCalled();
  });

  it("records a completed run with output, processed, and durationMs", async () => {
    const result = await runJob("test-job", "cron");
    expect(result).toEqual({
      status: "completed",
      output: "did work",
      processed: 5,
      logId: "log-1",
    });
    // running row inserted first
    expect(logCreate).toHaveBeenCalledOnce();
    const createData = logCreate.mock.calls[0][0].data;
    expect(createData).toMatchObject({
      jobKey: "test-job",
      status: "running",
      triggeredBy: "cron",
    });
    expect(createData.startedAt).toBeInstanceOf(Date);
    // then finalized
    expect(logUpdate).toHaveBeenCalledOnce();
    const updateArgs = logUpdate.mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: "log-1" });
    expect(updateArgs.data.status).toBe("completed");
    expect(updateArgs.data.output).toBe("did work");
    expect(updateArgs.data.processed).toBe(5);
    expect(updateArgs.data.finishedAt).toBeInstanceOf(Date);
    expect(typeof updateArgs.data.durationMs).toBe("number");
    expect(updateArgs.data.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("passes triggeredAt/triggeredBy through to the handler context", async () => {
    await runJob("test-job", "user-42");
    expect(handler).toHaveBeenCalledOnce();
    const ctx = handler.mock.calls[0][0];
    expect(ctx.triggeredBy).toBe("user-42");
    expect(ctx.triggeredAt).toBeInstanceOf(Date);
    expect(ctx.dryRun).toBeUndefined();
  });

  it("stores null output/processed for a silent success", async () => {
    handler.mockResolvedValue({});
    const result = await runJob("test-job", "cron");
    expect(result.status).toBe("completed");
    expect(result.output).toBeUndefined();
    expect(result.processed).toBeUndefined();
    const updateData = logUpdate.mock.calls[0][0].data;
    expect(updateData.output).toBeNull();
    expect(updateData.processed).toBeNull();
  });

  it("records 'skipped' when the handler returns {status:'skipped'}", async () => {
    handler.mockResolvedValue({ status: "skipped", output: "cadence gate" });
    const result = await runJob("test-job", "cron");
    expect(result.status).toBe("skipped");
    expect(result.output).toBe("cadence gate");
    expect(logUpdate.mock.calls[0][0].data.status).toBe("skipped");
  });

  it("records a failed run with the error message + stack when the handler throws", async () => {
    handler.mockRejectedValue(new Error("boom"));
    const result = await runJob("test-job", "cron");
    expect(result.status).toBe("failed");
    expect(result.error).toContain("boom");
    expect(result.logId).toBe("log-1");
    const updateData = logUpdate.mock.calls[0][0].data;
    expect(updateData.status).toBe("failed");
    expect(updateData.error).toContain("boom");
    expect(updateData.error).toContain("Error: boom"); // stack included
    expect(updateData.finishedAt).toBeInstanceOf(Date);
    expect(typeof updateData.durationMs).toBe("number");
    expect(log.error).toHaveBeenCalled();
  });

  it("stringifies non-Error throwables", async () => {
    handler.mockRejectedValue("plain string failure");
    const result = await runJob("test-job", "cron");
    expect(result.status).toBe("failed");
    expect(result.error).toBe("plain string failure");
  });
});

describe("runJob — disabled-job gating", () => {
  it("returns 'disabled' without running the handler when JobConfig disables the job", async () => {
    configFindUnique.mockResolvedValue({ jobKey: "test-job", isEnabled: false });
    const result = await runJob("test-job", "cron");
    expect(result.status).toBe("disabled");
    expect(result.output).toContain('Job "test-job" is disabled');
    expect(handler).not.toHaveBeenCalled();
    expect(logCreate).not.toHaveBeenCalled();
  });

  it("runs normally when the config row exists but isEnabled is true", async () => {
    configFindUnique.mockResolvedValue({ jobKey: "test-job", isEnabled: true });
    const result = await runJob("test-job", "cron");
    expect(result.status).toBe("completed");
    expect(handler).toHaveBeenCalledOnce();
  });

  it("force:true bypasses the disabled check entirely (manual 'Run now')", async () => {
    configFindUnique.mockResolvedValue({ jobKey: "test-job", isEnabled: false });
    const result = await runJob("test-job", "admin-1", { force: true });
    expect(result.status).toBe("completed");
    // force skips the config lookup — the toggle is never even read
    expect(configFindUnique).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledOnce();
  });

  it("dryRun bypasses the disabled check (previewing a paused job)", async () => {
    installJob({ supportsDryRun: true });
    configFindUnique.mockResolvedValue({ jobKey: "test-job", isEnabled: false });
    const result = await runJob("test-job", "admin-1", { dryRun: true });
    expect(result.status).toBe("skipped");
    expect(configFindUnique).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledOnce();
  });
});

describe("runJob — concurrency guard", () => {
  it("returns 'skipped' when another run is in progress, without a new log row", async () => {
    const startedAt = new Date("2026-07-16T10:00:00.000Z");
    logFindFirst.mockResolvedValue({ id: "other", startedAt });
    const result = await runJob("test-job", "cron");
    expect(result.status).toBe("skipped");
    expect(result.output).toBe(
      "Job is already running (started 2026-07-16T10:00:00.000Z)"
    );
    expect(handler).not.toHaveBeenCalled();
    expect(logCreate).not.toHaveBeenCalled();
    // guard only looks at running rows from the last hour
    const findArgs = logFindFirst.mock.calls[0][0];
    expect(findArgs.where.jobKey).toBe("test-job");
    expect(findArgs.where.status).toBe("running");
    expect(findArgs.where.startedAt.gte).toBeInstanceOf(Date);
  });

  it("reaps abandoned running rows (>1h old) as failed before checking the lock", async () => {
    logUpdateMany.mockResolvedValue({ count: 2 });
    await runJob("test-job", "cron");
    expect(logUpdateMany).toHaveBeenCalledOnce();
    const reapArgs = logUpdateMany.mock.calls[0][0];
    expect(reapArgs.where).toMatchObject({ jobKey: "test-job", status: "running" });
    expect(reapArgs.where.startedAt.lt).toBeInstanceOf(Date);
    expect(reapArgs.data.status).toBe("failed");
    expect(reapArgs.data.error).toMatch(/abandoned/i);
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it("force:true skips both the reap and the in-progress check", async () => {
    logFindFirst.mockResolvedValue({ id: "other", startedAt: new Date() });
    const result = await runJob("test-job", "admin-1", { force: true });
    expect(result.status).toBe("completed");
    expect(logUpdateMany).not.toHaveBeenCalled();
    expect(logFindFirst).not.toHaveBeenCalled();
  });
});

describe("runJob — dry runs", () => {
  it("rejects dryRun for jobs that don't declare supportsDryRun", async () => {
    // default job has no supportsDryRun
    const result = await runJob("test-job", "admin-1", { dryRun: true });
    expect(result).toEqual({
      status: "failed",
      error: 'Job "test-job" doesn\'t support dry-run preview yet.',
    });
    expect(handler).not.toHaveBeenCalled();
    expect(logCreate).not.toHaveBeenCalled();
    expect(configFindUnique).not.toHaveBeenCalled();
  });

  it("passes ctx.dryRun=true and records the run as 'skipped' with a DRY RUN prefix", async () => {
    installJob({ supportsDryRun: true });
    handler.mockResolvedValue({ output: "Would email 3 people", processed: 3 });
    const result = await runJob("test-job", "admin-1", { dryRun: true });
    expect(handler.mock.calls[0][0].dryRun).toBe(true);
    expect(result.status).toBe("skipped");
    expect(result.output).toBe(
      "DRY RUN — nothing was sent or written.\nWould email 3 people"
    );
    expect(result.processed).toBe(3);
    const updateData = logUpdate.mock.calls[0][0].data;
    expect(updateData.status).toBe("skipped");
    expect(updateData.output).toBe(
      "DRY RUN — nothing was sent or written.\nWould email 3 people"
    );
  });

  it("trims the dangling newline when a dry-run handler returns no output", async () => {
    installJob({ supportsDryRun: true });
    handler.mockResolvedValue({});
    const result = await runJob("test-job", "admin-1", { dryRun: true });
    expect(result.output).toBe("DRY RUN — nothing was sent or written.");
  });

  it("skips the concurrency guard for dry runs", async () => {
    installJob({ supportsDryRun: true });
    logFindFirst.mockResolvedValue({ id: "other", startedAt: new Date() });
    const result = await runJob("test-job", "admin-1", { dryRun: true });
    expect(result.status).toBe("skipped");
    expect(logFindFirst).not.toHaveBeenCalled();
    expect(logUpdateMany).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledOnce();
  });

  it("records a dry-run failure but never sends the failure-streak alert", async () => {
    installJob({ supportsDryRun: true });
    handler.mockRejectedValue(new Error("preview exploded"));
    const result = await runJob("test-job", "admin-1", { dryRun: true });
    expect(result.status).toBe("failed");
    expect(logUpdate.mock.calls[0][0].data.status).toBe("failed");
    // maybeAlertJobFailing is never consulted for dry runs
    expect(logFindMany).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });
});

describe("runJob — failure-streak alerting", () => {
  const failed = { status: "failed" };
  const completed = { status: "completed" };
  const admins = [{ id: "admin-1" }, { id: "admin-2" }];

  beforeEach(() => {
    handler.mockRejectedValue(new Error("kaput"));
    userFindMany.mockResolvedValue(admins);
  });

  it("fires exactly once at the 3rd consecutive failure (no prior run)", async () => {
    logFindMany.mockResolvedValue([failed, failed, failed]);
    const result = await runJob("test-job", "cron");
    expect(result.status).toBe("failed");
    expect(notifyMock).toHaveBeenCalledOnce();
    const args = notifyMock.mock.calls[0][0];
    expect(args.recipientId).toEqual(["admin-1", "admin-2"]);
    expect(args.type).toBe("job-failing");
    expect(args.title).toBe("Scheduled job failing: Test Job");
    expect(args.body).toContain("3 consecutive runs have failed");
    expect(args.body).toContain("kaput");
    expect(args.href).toBe("/admin/jobs/test-job");
    expect(args.entityType).toBe("job");
    expect(args.entityId).toBe("test-job");
  });

  it("fires at the 3rd failure when the prior run completed (fresh streak)", async () => {
    logFindMany.mockResolvedValue([failed, failed, failed, completed]);
    await runJob("test-job", "cron");
    expect(notifyMock).toHaveBeenCalledOnce();
  });

  it("does NOT fire at the 2nd failure", async () => {
    logFindMany.mockResolvedValue([failed, failed]);
    await runJob("test-job", "cron");
    expect(notifyMock).not.toHaveBeenCalled();
    expect(userFindMany).not.toHaveBeenCalled();
  });

  it("does NOT fire again at the 4th failure (prior run already failed)", async () => {
    logFindMany.mockResolvedValue([failed, failed, failed, failed]);
    await runJob("test-job", "cron");
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("does NOT fire when a completed run breaks the streak", async () => {
    logFindMany.mockResolvedValue([failed, completed, failed]);
    await runJob("test-job", "cron");
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("queries the last streak+1 finished runs, newest first", async () => {
    logFindMany.mockResolvedValue([failed, failed, failed]);
    await runJob("test-job", "cron");
    expect(logFindMany).toHaveBeenCalledWith({
      where: { jobKey: "test-job", status: { in: ["completed", "failed"] } },
      orderBy: { startedAt: "desc" },
      take: 4,
      select: { status: true },
    });
  });

  it("skips the alert silently when there are no active admins", async () => {
    logFindMany.mockResolvedValue([failed, failed, failed]);
    userFindMany.mockResolvedValue([]);
    const result = await runJob("test-job", "cron");
    expect(result.status).toBe("failed");
    expect(notifyMock).not.toHaveBeenCalled();
    expect(userFindMany).toHaveBeenCalledWith({
      where: { isActive: true, role: "ADMIN" },
      select: { id: true },
    });
  });

  it("still returns the original failure when the alert itself throws (best-effort)", async () => {
    logFindMany.mockResolvedValue([failed, failed, failed]);
    notifyMock.mockRejectedValue(new Error("smtp down"));
    const result = await runJob("test-job", "cron");
    expect(result.status).toBe("failed");
    expect(result.error).toContain("kaput");
  });

  it("a success never consults the streak query at all", async () => {
    handler.mockResolvedValue({ output: "ok" });
    await runJob("test-job", "cron");
    expect(logFindMany).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });
});

describe("runAllJobs", () => {
  it("runs every registered job sequentially; one failure doesn't stop the rest", async () => {
    const goodHandler = vi.fn(async () => ({ output: "fine" }));
    const badHandler = vi.fn(async () => {
      throw new Error("nope");
    });
    const jobs: JobDefinition[] = [
      { key: "good", name: "Good", description: "", schedule: "", handler: goodHandler },
      { key: "bad", name: "Bad", description: "", schedule: "", handler: badHandler },
    ];
    listJobsMock.mockReturnValue(jobs);
    getJobMock.mockImplementation((key: string) => jobs.find((j) => j.key === key));
    logCreate
      .mockResolvedValueOnce({ id: "log-good" })
      .mockResolvedValueOnce({ id: "log-bad" });

    const results = await runAllJobs("cron");
    expect(results.good.status).toBe("completed");
    expect(results.bad.status).toBe("failed");
    expect(goodHandler).toHaveBeenCalledOnce();
    expect(badHandler).toHaveBeenCalledOnce();
  });
});
