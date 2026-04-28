import { describe, it, expect } from "vitest";
import { conditionalBranchHandler } from "./conditional-branch";
import type { WorkflowContext } from "../context";

const ctx = (overrides: Partial<WorkflowContext> = {}): WorkflowContext => ({
  subject: {
    id: "u1",
    firstName: "Alex",
    lastName: "Rivera",
    fullName: "Alex Rivera",
    email: "alex@example.com",
    jobTitle: "Engineer",
    department: "Engineering",
    startDate: null,
    ...((overrides.subject as Partial<WorkflowContext["subject"]>) || {}),
  },
  manager: {
    id: null,
    firstName: null,
    fullName: "(no manager)",
    email: null,
  },
  company: { name: "Acme" },
  workflow: {
    id: "wf1",
    name: "Test",
    startDate: new Date(0),
    targetDate: null,
  },
  portal: { url: "" },
  ...overrides,
});

const baseInput = {
  stepType: "CONDITIONAL_BRANCH" as const,
  context: ctx(),
  instanceId: "inst1",
  instanceStepId: "step1",
  subjectType: "EMPLOYEE" as const,
  subjectId: "u1",
};

describe("conditionalBranchHandler", () => {
  it("completes when an equality condition is true", async () => {
    const r = await conditionalBranchHandler({
      ...baseInput,
      config: { condition: 'subject.jobTitle === "Engineer"' },
    });
    expect(r.kind).toBe("completed");
  });

  it("matches case-insensitively for string comparisons", async () => {
    const r = await conditionalBranchHandler({
      ...baseInput,
      config: { condition: 'subject.jobTitle === "engineer"' },
    });
    expect(r.kind).toBe("completed");
  });

  it("skips when an equality condition is false", async () => {
    const r = await conditionalBranchHandler({
      ...baseInput,
      config: { condition: 'subject.jobTitle === "Manager"' },
    });
    expect(r.kind).toBe("skipped");
  });

  it("supports inequality (!==)", async () => {
    const r = await conditionalBranchHandler({
      ...baseInput,
      config: { condition: 'subject.department !== "Sales"' },
    });
    expect(r.kind).toBe("completed");
  });

  it("supports numeric literals", async () => {
    const r = await conditionalBranchHandler({
      ...baseInput,
      context: ctx({
        subject: {
          id: "u1",
          firstName: null,
          lastName: null,
          fullName: "Test",
          email: null,
          jobTitle: null,
          department: null,
          // @ts-expect-error — deliberate to test number resolution
          level: 3,
          startDate: null,
        },
      }),
      config: { condition: "subject.level === 3" },
    });
    expect(r.kind).toBe("completed");
  });

  it("treats an empty condition as a permissive pass", async () => {
    const r = await conditionalBranchHandler({
      ...baseInput,
      config: { condition: "" },
    });
    expect(r.kind).toBe("completed");
  });

  it("throws on a malformed condition", async () => {
    await expect(
      conditionalBranchHandler({
        ...baseInput,
        config: { condition: "subject.firstName && something" },
      })
    ).rejects.toThrow(/not understood/i);
  });

  it("renders missing path as undefined → falsy", async () => {
    const r = await conditionalBranchHandler({
      ...baseInput,
      config: { condition: 'subject.nope === "foo"' },
    });
    expect(r.kind).toBe("skipped");
  });
});
