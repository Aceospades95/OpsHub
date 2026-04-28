import type { StepHandler } from "./index";
import type { ConditionalBranchConfig } from "../step-types";

/**
 * CONDITIONAL_BRANCH step — supports the simplest possible expression:
 *   `path.to.field === "value"`
 *   `path.to.field == "value"`
 *   `path.to.field !== "value"`
 *
 * No quotes around the LHS, double or single quotes around the RHS,
 * whitespace tolerated. Anything fancier (boolean ops, nested parens,
 * arithmetic) should be split into multiple steps — the engine
 * intentionally doesn't ship a JS evaluator. Untrusted templates
 * shouldn't be able to run arbitrary code against the context.
 *
 * Outcome:
 *   - Condition truthy → step is COMPLETED (proceed normally).
 *   - Condition falsy  → step is SKIPPED (downstream AFTER_STEP entries
 *     still get scheduled — skipped is a terminal state for that purpose).
 *
 * NOTE: ifTrueStepId / ifFalseStepId are accepted in the config schema
 * for forward compatibility but Phase 4 doesn't honor them yet —
 * branching to an arbitrary step would require a richer execution graph.
 * For now, conditionals act as a guard that decides whether THIS step
 * (and any AFTER_STEP children waiting on it) advances.
 */

const COMPARISON_RE =
  /^\s*([\w.]+)\s*(===|!==|==|!=)\s*("[^"]*"|'[^']*'|true|false|null|-?\d+(?:\.\d+)?|[\w.]+)\s*$/;

export const conditionalBranchHandler: StepHandler = async ({
  config,
  context,
}) => {
  const c = config as unknown as ConditionalBranchConfig;
  const expr = (c.condition ?? "").trim();
  if (!expr) {
    // Empty condition is a no-op pass — better to be permissive here
    // than to fail noisy on a half-finished template.
    return { kind: "completed" };
  }

  const m = COMPARISON_RE.exec(expr);
  if (!m) {
    throw new Error(
      `Conditional expression not understood: ${expr}. Phase 4 supports only "path === value" comparisons.`
    );
  }

  const [, lhsPath, op, rhsRaw] = m;
  const lhs = resolvePath(context as unknown as Record<string, unknown>, lhsPath.split("."));
  const rhs = parseLiteral(rhsRaw);

  const eq = compareLoose(lhs, rhs);
  const truthy = op === "===" || op === "==" ? eq : !eq;

  if (truthy) return { kind: "completed", output: { branch: "true" } };
  return { kind: "skipped", reason: "conditional_branch_false" };
};

function resolvePath(obj: Record<string, unknown>, parts: string[]): unknown {
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in cur) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

function parseLiteral(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1);
  }
  // Bareword on the RHS isn't allowed — would invite ambiguity with
  // identifiers. Treat as the literal string for resilience.
  return raw;
}

function compareLoose(a: unknown, b: unknown): boolean {
  // Strings compare case-insensitively to make role checks ergonomic
  // (e.g. "engineer" === "Engineer"). Other types fall back to ===.
  if (typeof a === "string" && typeof b === "string") {
    return a.toLowerCase() === b.toLowerCase();
  }
  return a === b;
}
