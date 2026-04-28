import type { StepHandler } from "./index";

/**
 * WAIT step — does nothing meaningful at execution time. The engine
 * schedules it via the timing rule and we simply mark it complete when
 * its turn comes up. The actual "delay" is encoded in the step's
 * timingValue + timingType which the engine has already honored by the
 * time we get here.
 *
 * This handler exists mostly so the registry has an entry — without it
 * the engine would throw on a wait step.
 */
export const waitHandler: StepHandler = async () => ({
  kind: "completed",
  output: { waited: true },
});
