import type { StepHandler } from "./index";

/**
 * Placeholder handler for the three portal-driven step types:
 * REQUEST_DOCUMENT, REQUEST_SIGNATURE, REQUEST_FORM.
 *
 * Phase 4 only flips them to "waiting" so the instance timeline shows
 * them in flight. Phase 5's portal actions will call completeStep() with
 * the upload / signature / form output when the subject finishes.
 */
export const portalWaitHandler: StepHandler = async () => ({
  kind: "waiting",
  output: {
    note: "Awaiting subject action via portal (lands in Phase 5).",
  },
});
