import { describe, it, expect } from "vitest";
import {
  substituteVariables,
  validateStepConfig,
  STEP_TYPE_DEFINITIONS,
  getStepTypeDefinition,
} from "./step-types";

describe("substituteVariables", () => {
  const ctx = {
    subject: { firstName: "Alex", fullName: "Alex Rivera" },
    company: { name: "Acme" },
    workflow: { startDate: new Date("2026-06-01T00:00:00Z") },
  };

  it("replaces simple paths", () => {
    expect(substituteVariables("Hi {{subject.firstName}}!", ctx)).toBe("Hi Alex!");
  });

  it("supports multiple substitutions in one string", () => {
    expect(
      substituteVariables(
        "{{subject.fullName}} joins {{company.name}}",
        ctx
      )
    ).toBe("Alex Rivera joins Acme");
  });

  it("renders missing paths as empty string, never as 'undefined'", () => {
    expect(substituteVariables("Hi {{nope.path}}", ctx)).toBe("Hi ");
    // Crucially, never includes the literal "undefined":
    expect(substituteVariables("Hi {{nope.path}}", ctx)).not.toContain("undefined");
  });

  it("formats Date values via toLocaleDateString", () => {
    const out = substituteVariables("Start: {{workflow.startDate}}", ctx);
    expect(out).toContain("2026");
  });

  it("ignores whitespace inside the braces", () => {
    expect(substituteVariables("{{ subject.firstName }}", ctx)).toBe("Alex");
  });

  it("leaves text without braces untouched", () => {
    expect(substituteVariables("plain text", ctx)).toBe("plain text");
  });
});

describe("validateStepConfig", () => {
  it("accepts a valid SEND_EMAIL config", () => {
    const r = validateStepConfig("SEND_EMAIL", {
      toRecipient: "subject",
      emailTemplateId: "tpl_123",
    });
    expect(r.ok).toBe(true);
  });

  it("rejects SEND_EMAIL without an emailTemplateId", () => {
    const r = validateStepConfig("SEND_EMAIL", {
      toRecipient: "subject",
    });
    expect(r.ok).toBe(false);
  });

  it("accepts a valid WAIT config and rejects negative days", () => {
    expect(validateStepConfig("WAIT", { delayDays: 3 }).ok).toBe(true);
    expect(validateStepConfig("WAIT", { delayDays: -1 }).ok).toBe(false);
  });

  it("rejects ASSIGN_TASK_TO_USER missing the title", () => {
    const r = validateStepConfig("ASSIGN_TASK_TO_USER", {
      assignee: "manager",
      title: "",
      dueOffsetDays: 0,
    });
    expect(r.ok).toBe(false);
  });

  it("accepts a SCHEDULE_MEETING config with attendees array", () => {
    const r = validateStepConfig("SCHEDULE_MEETING", {
      meetingTitle: "Onboarding",
      attendees: ["subject", "manager"],
      durationMinutes: 30,
      offsetDays: 0,
    });
    expect(r.ok).toBe(true);
  });

  it("rejects a SCHEDULE_MEETING with duration outside the allowed range", () => {
    const r = validateStepConfig("SCHEDULE_MEETING", {
      meetingTitle: "Onboarding",
      attendees: ["subject"],
      durationMinutes: 5,
      offsetDays: 0,
    });
    expect(r.ok).toBe(false);
  });
});

describe("STEP_TYPE_DEFINITIONS", () => {
  it("includes one entry per WorkflowStepType enum value", () => {
    // 13 step types per the spec.
    expect(STEP_TYPE_DEFINITIONS).toHaveLength(13);
  });

  it("getStepTypeDefinition resolves known types", () => {
    const def = getStepTypeDefinition("WAIT");
    expect(def.label).toBe("Wait");
  });

  it("each definition has a non-empty default config", () => {
    for (const def of STEP_TYPE_DEFINITIONS) {
      expect(def.defaultConfig).toBeDefined();
    }
  });
});
