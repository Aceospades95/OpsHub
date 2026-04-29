/**
 * AFTER_STEP cycle detection for workflow templates.
 *
 * Lives in `src/lib/workflows/` rather than the workflow-templates
 * server action so it can be imported by tests directly — server-action
 * files (`"use server"`) only export Server Actions and Next.js's
 * compiler strips/errors on incidental exports.
 */

import { db } from "@/lib/db";

export type StepLookup = (
  id: string
) => Promise<{ afterStepId: string | null; workflowTemplateId: string } | null>;

const defaultStepLookup: StepLookup = (id) =>
  db.workflowStep.findUnique({
    where: { id },
    select: { afterStepId: true, workflowTemplateId: true },
  });

/**
 * Walk the AFTER_STEP graph upward from `predecessorId` to detect a
 * cycle that would form if `selfId` ended up depending on itself.
 *
 * Without this guard, a template editor can produce A → AFTER_STEP B
 * and B → AFTER_STEP A. The engine never throws — `resolveScheduledFor`
 * returns null when the predecessor hasn't completed, so both steps
 * stay PENDING forever and the instance silently stalls.
 *
 * Returns true when introducing `selfId.afterStepId = predecessorId`
 * would create a cycle. `selfId` is null for newly-created steps that
 * don't yet have an id; in that case there's nothing to chase back
 * through and the only invariant is that the chain is finite.
 *
 * The fetcher is injectable so unit tests can supply an in-memory
 * fixture without spinning up Prisma.
 */
export async function wouldCreateAfterStepCycle(
  templateId: string,
  selfId: string | null,
  predecessorId: string | null,
  fetchStep: StepLookup = defaultStepLookup
): Promise<boolean> {
  if (!predecessorId) return false;

  // Self-reference is the trivial cycle.
  if (selfId && predecessorId === selfId) return true;

  // Walk upward through afterStepId. Cap iterations as a safety net so
  // a corrupt DB row can't loop us forever.
  const seen = new Set<string>();
  let cursor: string | null = predecessorId;
  for (let i = 0; i < 256 && cursor; i++) {
    if (seen.has(cursor)) {
      // Pre-existing cycle in stored data — bail and treat as cycle
      // so we don't compound it.
      return true;
    }
    seen.add(cursor);
    if (selfId && cursor === selfId) return true;
    const next = await fetchStep(cursor);
    if (!next) return false;
    // Defense-in-depth: a step from a different template means the
    // afterStepId is bogus, treat as a cycle so we reject the save.
    if (next.workflowTemplateId !== templateId) return true;
    cursor = next.afterStepId;
  }
  // Hit the iteration cap with the chain still active — treat as a
  // cycle rather than allow an unbounded scheduling chain.
  return cursor !== null;
}
