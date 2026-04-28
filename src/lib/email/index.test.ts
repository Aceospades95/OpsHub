import { describe, it, expect } from "vitest";

// We don't pull in the rest of the email module here because
// `getActiveDriver` reads env vars at import time. The truncate helper
// is a pure function we can test in isolation.
import { truncateError } from "./index";

describe("truncateError", () => {
  it("passes short messages through unchanged", () => {
    expect(truncateError("oh no")).toBe("oh no");
    expect(truncateError("")).toBe("");
  });

  it("preserves messages right at the boundary", () => {
    const exactly500 = "a".repeat(500);
    expect(truncateError(exactly500)).toBe(exactly500);
  });

  it("truncates oversized messages and appends an ellipsis tag", () => {
    const huge = "x".repeat(4000);
    const r = truncateError(huge);
    expect(r.length).toBe(500);
    expect(r.endsWith("… [truncated]")).toBe(true);
    // The bulk of the original message is still present so an admin
    // can read the first error line in EmailLog.error.
    expect(r.startsWith("xxxxxx")).toBe(true);
  });

  it("preserves the leading content (admins read errors top-down)", () => {
    const prefix = "AccessDeniedException: User is not authorized to ses:SendEmail";
    const huge = prefix + " ".repeat(2000) + "RequestId: deadbeef";
    const r = truncateError(huge);
    expect(r.startsWith(prefix)).toBe(true);
  });
});
