/**
 * Consistency tests for the notification type registry.
 *
 * The NotificationType union (types.ts), NOTIFICATION_TYPE_LABELS, and
 * NOTIFICATION_TYPE_REGISTRY (registry.ts) must stay in lockstep — the
 * admin Rules tab renders one card per registry entry, and the engine
 * accepts any union member. TypeScript enforces half of this
 * (NOTIFICATION_TYPE_LABELS is a Record<NotificationType, string>, so a
 * union member without a label fails to compile, and every registry
 * `key` must be a union member); these tests close the runtime gaps the
 * compiler can't see, like a union member missing from the registry
 * ARRAY or duplicate/orphaned entries.
 */
import { describe, it, expect } from "vitest";

import { NOTIFICATION_TYPE_LABELS, type NotificationType } from "./types";
import {
  NOTIFICATION_TYPE_REGISTRY,
  NOTIFICATION_TYPE_INFO,
  TEMPLATE_VARIABLES,
} from "./registry";

// The labels record is the exhaustive runtime proxy for the union: its
// key set IS the NotificationType union (typechecked as Record<...>).
const unionKeys = Object.keys(NOTIFICATION_TYPE_LABELS) as NotificationType[];
const registryKeys = NOTIFICATION_TYPE_REGISTRY.map((t) => t.key);

describe("NotificationType ↔ labels ↔ registry consistency", () => {
  it("every NotificationType has a registry entry (no missing types)", () => {
    const missingFromRegistry = unionKeys.filter((k) => !registryKeys.includes(k));
    expect(missingFromRegistry).toEqual([]);
  });

  it("every registry entry maps back to a NotificationType (no orphans)", () => {
    const orphans = registryKeys.filter((k) => !unionKeys.includes(k));
    expect(orphans).toEqual([]);
  });

  it("the registry has no duplicate keys", () => {
    expect(new Set(registryKeys).size).toBe(registryKeys.length);
    // With both direction checks above, this pins exact 1:1 coverage.
    expect(registryKeys.length).toBe(unionKeys.length);
  });

  it("every label is a non-empty string and each registry entry echoes it verbatim", () => {
    for (const entry of NOTIFICATION_TYPE_REGISTRY) {
      expect(NOTIFICATION_TYPE_LABELS[entry.key]).toBeTruthy();
      expect(entry.label).toBe(NOTIFICATION_TYPE_LABELS[entry.key]);
    }
  });

  it("every entry documents its trigger and default recipients", () => {
    for (const entry of NOTIFICATION_TYPE_REGISTRY) {
      expect(entry.trigger.trim().length, `trigger for ${entry.key}`).toBeGreaterThan(0);
      expect(
        entry.defaultRecipients.trim().length,
        `defaultRecipients for ${entry.key}`
      ).toBeGreaterThan(0);
      expect(typeof entry.emailsByDefault, `emailsByDefault for ${entry.key}`).toBe(
        "boolean"
      );
    }
  });

  it("NOTIFICATION_TYPE_INFO indexes every registry entry by key, identically", () => {
    expect(NOTIFICATION_TYPE_INFO.size).toBe(NOTIFICATION_TYPE_REGISTRY.length);
    for (const entry of NOTIFICATION_TYPE_REGISTRY) {
      expect(NOTIFICATION_TYPE_INFO.get(entry.key)).toBe(entry);
    }
  });
});

describe("TEMPLATE_VARIABLES", () => {
  it("exactly matches the variable set the engine substitutes", () => {
    // Mirror of the `vars` object built in renderFor() (./index.ts). If a
    // variable is added or removed there, this list — and the admin UI
    // hint the registry drives — must change with it.
    expect([...TEMPLATE_VARIABLES].sort()).toEqual([
      "body",
      "emailBody",
      "heading",
      "href",
      "recipientName",
      "title",
    ]);
  });

  it("every variable is substitutable by the {{\\w+}} pattern and unique", () => {
    for (const variable of TEMPLATE_VARIABLES) {
      // substituteVars() only matches word characters inside the braces —
      // a variable with a dash or dot could never be substituted.
      expect(variable).toMatch(/^\w+$/);
    }
    expect(new Set(TEMPLATE_VARIABLES).size).toBe(TEMPLATE_VARIABLES.length);
  });
});
