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

  // ─── HTML-escape mode ─────────────────────────────────────────────────
  // User-editable name / job-title fields can contain HTML. When the
  // result is fed into an email's html body or `dangerouslySetInnerHTML`,
  // we must escape values but leave the surrounding admin-authored
  // template markup intact.

  it("escapes HTML in substituted values when mode is 'html'", () => {
    const evilCtx = {
      subject: { firstName: '<script>alert(1)</script>' },
    };
    const out = substituteVariables(
      "<p>Hi {{subject.firstName}}!</p>",
      evilCtx,
      "html"
    );
    expect(out).toBe(
      "<p>Hi &lt;script&gt;alert(1)&lt;/script&gt;!</p>"
    );
  });

  it("does not escape values in 'text' (default) mode", () => {
    const evilCtx = {
      subject: { firstName: '<b>bold</b>' },
    };
    expect(
      substituteVariables("Hi {{subject.firstName}}", evilCtx)
    ).toBe("Hi <b>bold</b>");
  });

  it("leaves the admin-authored template markup intact in HTML mode", () => {
    const out = substituteVariables(
      "<p>Hi {{subject.firstName}}</p>",
      ctx,
      "html"
    );
    // The <p> tags from the template literal aren't escaped — only the
    // substituted value is. Admin-authored HTML is intentionally trusted.
    expect(out).toBe("<p>Hi Alex</p>");
  });

  it("escapes attribute-breaking characters (\", ', &) in HTML mode", () => {
    const evilCtx = {
      subject: { firstName: `O"Connor & 'co'` },
    };
    const out = substituteVariables(
      "{{subject.firstName}}",
      evilCtx,
      "html"
    );
    expect(out).toBe("O&quot;Connor &amp; &#39;co&#39;");
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

  it("accepts SEND_EMAIL with a missing emailTemplateId (draft mode)", () => {
    // Editor saves partially-filled steps so the user can iterate. The
    // engine's send-email handler still throws at runtime if the
    // template id is missing — that's the strict gate.
    const r = validateStepConfig("SEND_EMAIL", {
      toRecipient: "subject",
    });
    expect(r.ok).toBe(true);
  });

  it("accepts a valid WAIT config and rejects negative days", () => {
    expect(validateStepConfig("WAIT", { delayDays: 3 }).ok).toBe(true);
    expect(validateStepConfig("WAIT", { delayDays: -1 }).ok).toBe(false);
  });

  it("accepts ASSIGN_TASK_TO_USER with an empty title (draft mode)", () => {
    const r = validateStepConfig("ASSIGN_TASK_TO_USER", {
      assignee: "manager",
      title: "",
      dueOffsetDays: 0,
    });
    expect(r.ok).toBe(true);
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

  it("accepts an unbounded SCHEDULE_MEETING duration in draft mode", () => {
    // Draft saves are permissive — the engine just creates a
    // 5-minute meeting if that's what the author chose. The previous
    // tight 15-480 range was overzealous.
    const r = validateStepConfig("SCHEDULE_MEETING", {
      meetingTitle: "Onboarding",
      attendees: ["subject"],
      durationMinutes: 5,
      offsetDays: 0,
    });
    expect(r.ok).toBe(true);
  });

  it("accepts the picker-added defaults for every step type", () => {
    // Regression for the bug where "Send email" / "Task for team" /
    // etc. couldn't be added because their default config was rejected
    // by overly-strict z.string().min(1) gates. This test pins each
    // STEP_TYPE_DEFINITIONS default config against its validator.
    for (const def of STEP_TYPE_DEFINITIONS) {
      const r = validateStepConfig(def.type, def.defaultConfig);
      expect(r.ok, `default config for ${def.type} must validate`).toBe(true);
    }
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
