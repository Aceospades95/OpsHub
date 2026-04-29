import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { log } from "./log";

// We capture the underlying console methods so we can assert on what
// the logger emits, then restore them between tests.
let logSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});

describe("log (dev mode pretty output — vitest doesn't set NODE_ENV=production)", () => {
  it("info goes to console.log with the standard head", () => {
    log.info("jobs.test", "ran a thing");
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toBe("INFO [jobs.test] ran a thing");
    // No fields → only one arg
    expect(logSpy.mock.calls[0]).toHaveLength(1);
  });

  it("warn goes to console.warn", () => {
    log.warn("jobs.test", "soft failure", { count: 3 });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toBe("WARN [jobs.test] soft failure");
    expect(warnSpy.mock.calls[0][1]).toEqual({ count: 3 });
  });

  it("error goes to console.error", () => {
    log.error("jobs.test", "failed");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toBe("ERROR [jobs.test] failed");
  });

  it("error with an Error instance flattens name/message/stack", () => {
    const err = new Error("boom");
    log.error("jobs.test", "oops", err);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const fields = errorSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(fields.err_name).toBe("Error");
    expect(fields.err_msg).toBe("boom");
    expect(typeof fields.err_stack).toBe("string");
  });

  it("error with an Error + extra fields merges both", () => {
    log.error("jobs.test", "oops", new Error("boom"), { jobKey: "tick" });
    const fields = errorSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(fields.err_msg).toBe("boom");
    expect(fields.jobKey).toBe("tick");
  });

  it("error with a plain-object first arg treats it as fields", () => {
    log.error("jobs.test", "oops", { code: "P2003", target: "User" });
    const fields = errorSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(fields.code).toBe("P2003");
    expect(fields.target).toBe("User");
    expect(fields.err_name).toBeUndefined();
  });

  it("error with a string treats it as the err value", () => {
    log.error("jobs.test", "oops", "some-cli-stderr-blob");
    const fields = errorSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(fields.err).toBe("some-cli-stderr-blob");
  });

  it("trims long stacks to ~4000 chars to protect log aggregators", () => {
    const err = new Error("x");
    err.stack = "trace\n".repeat(2000); // ~12000 chars
    log.error("jobs.test", "x", err);
    const fields = errorSpy.mock.calls[0][1] as Record<string, unknown>;
    expect((fields.err_stack as string).length).toBeLessThanOrEqual(4000);
  });

  it("undefined error second arg is a no-op (head only)", () => {
    log.error("jobs.test", "msg", undefined);
    expect(errorSpy).toHaveBeenCalledWith("ERROR [jobs.test] msg");
  });
});
