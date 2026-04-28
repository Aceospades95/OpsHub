import { describe, it, expect } from "vitest";

// `wouldCreateAfterStepCycle` is exported alongside an injectable
// fetcher so we can test the graph walk without a Prisma stand-in.
// The action surface itself (addWorkflowStep / updateWorkflowStep) is
// covered by integration tests; this file verifies the cycle algorithm.
import {
  wouldCreateAfterStepCycle,
  type StepLookup,
} from "./cycle-check";

function fixtureLookup(
  graph: Record<
    string,
    { afterStepId: string | null; workflowTemplateId: string }
  >
): StepLookup {
  return async (id) => graph[id] ?? null;
}

describe("wouldCreateAfterStepCycle", () => {
  it("allows null predecessor", async () => {
    const r = await wouldCreateAfterStepCycle(
      "tpl1",
      "step1",
      null,
      fixtureLookup({})
    );
    expect(r).toBe(false);
  });

  it("rejects self-reference", async () => {
    const r = await wouldCreateAfterStepCycle(
      "tpl1",
      "stepA",
      "stepA",
      fixtureLookup({})
    );
    expect(r).toBe(true);
  });

  it("allows a finite chain that terminates", async () => {
    // stepA depends on stepB depends on stepC (no after).
    // Asking "can stepNew → stepA" — chain stepA → stepB → stepC → null.
    // No cycle, so allow.
    const r = await wouldCreateAfterStepCycle(
      "tpl1",
      "stepNew",
      "stepA",
      fixtureLookup({
        stepA: { afterStepId: "stepB", workflowTemplateId: "tpl1" },
        stepB: { afterStepId: "stepC", workflowTemplateId: "tpl1" },
        stepC: { afterStepId: null, workflowTemplateId: "tpl1" },
      })
    );
    expect(r).toBe(false);
  });

  it("rejects when chain leads back to self", async () => {
    // stepA depends on stepB. We're asking "can stepA → stepB?" with
    // the lookup saying stepB → stepA — i.e. a 2-cycle.
    const r = await wouldCreateAfterStepCycle(
      "tpl1",
      "stepA",
      "stepB",
      fixtureLookup({
        stepB: { afterStepId: "stepA", workflowTemplateId: "tpl1" },
        stepA: { afterStepId: null, workflowTemplateId: "tpl1" },
      })
    );
    expect(r).toBe(true);
  });

  it("rejects a 3-cycle", async () => {
    const r = await wouldCreateAfterStepCycle(
      "tpl1",
      "stepA",
      "stepB",
      fixtureLookup({
        stepB: { afterStepId: "stepC", workflowTemplateId: "tpl1" },
        stepC: { afterStepId: "stepA", workflowTemplateId: "tpl1" },
        stepA: { afterStepId: null, workflowTemplateId: "tpl1" },
      })
    );
    expect(r).toBe(true);
  });

  it("rejects a pre-existing cycle in stored data", async () => {
    // stepB → stepC → stepB — bogus existing cycle. Walking from any
    // entry point should detect it before we compound the corruption.
    const r = await wouldCreateAfterStepCycle(
      "tpl1",
      "stepNew",
      "stepB",
      fixtureLookup({
        stepB: { afterStepId: "stepC", workflowTemplateId: "tpl1" },
        stepC: { afterStepId: "stepB", workflowTemplateId: "tpl1" },
      })
    );
    expect(r).toBe(true);
  });

  it("rejects a cross-template afterStepId", async () => {
    // The predecessor lives on a different template — the row is bogus
    // (the editor shouldn't allow it) and we treat it as a cycle so the
    // save is rejected rather than silently writing more bad data.
    const r = await wouldCreateAfterStepCycle(
      "tpl1",
      "stepNew",
      "stepFromOtherTpl",
      fixtureLookup({
        stepFromOtherTpl: { afterStepId: null, workflowTemplateId: "tpl2" },
      })
    );
    expect(r).toBe(true);
  });

  it("returns false when predecessor row is missing entirely", async () => {
    // Stale id (the predecessor was deleted between the picker render
    // and the save). The step.update will fail with a foreign-key
    // error from Prisma — fine, that's the right error path. We just
    // shouldn't pre-emptively claim a cycle here.
    const r = await wouldCreateAfterStepCycle(
      "tpl1",
      "stepNew",
      "ghost",
      fixtureLookup({})
    );
    expect(r).toBe(false);
  });
});
