/**
 * Tests for the pure parts of the unified-contacts lib (entity-type
 * set, labels, href building) plus resolveLinkTargets' batching /
 * skip-dangling behavior against a mocked db.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    client: { findMany: vi.fn() },
    supplier: { findMany: vi.fn() },
    subcontractor: { findMany: vi.fn() },
    partnership: { findMany: vi.fn() },
    bidOpportunity: { findMany: vi.fn() },
    project: { findMany: vi.fn() },
    contract: { findMany: vi.fn() },
    contactLink: { findMany: vi.fn() },
  },
}));

import { db } from "@/lib/db";
import {
  CONTACT_ENTITY_TYPES,
  CONTACT_ENTITY_TYPE_LABELS,
  CONTACT_ROLE_SUGGESTIONS,
  MAX_ROLE_TAGS_PER_LINK,
  MAX_ROLE_TAG_LENGTH,
  contactEntityHref,
  isContactEntityType,
  linkTargetKey,
  resolveLinkTargets,
} from "./contacts";

const dbMock = db as unknown as Record<string, { findMany: ReturnType<typeof vi.fn> }>;

beforeEach(() => {
  vi.clearAllMocks();
  for (const delegate of Object.values(dbMock)) {
    delegate.findMany.mockResolvedValue([]);
  }
});

describe("contact entity types", () => {
  it("covers exactly the seven linkable types", () => {
    expect([...CONTACT_ENTITY_TYPES]).toEqual([
      "client",
      "supplier",
      "subcontractor",
      "partnership",
      "bid",
      "project",
      "contract",
    ]);
  });

  it("has a label for every type", () => {
    for (const type of CONTACT_ENTITY_TYPES) {
      expect(CONTACT_ENTITY_TYPE_LABELS[type]).toBeTruthy();
    }
  });

  it("isContactEntityType accepts the closed set and rejects everything else", () => {
    for (const type of CONTACT_ENTITY_TYPES) {
      expect(isContactEntityType(type)).toBe(true);
    }
    expect(isContactEntityType("vehicle")).toBe(false);
    expect(isContactEntityType("")).toBe(false);
    expect(isContactEntityType("CLIENT")).toBe(false);
  });

  it("offers the standard role-tag vocabulary within the per-link caps", () => {
    expect([...CONTACT_ROLE_SUGGESTIONS]).toEqual([
      "Executive Sponsor",
      "Procurement",
      "Technical",
      "Billing/AP",
      "Field Ops",
      "Scheduling",
      "Legal",
      "PM",
    ]);
    expect(CONTACT_ROLE_SUGGESTIONS.length).toBeLessThanOrEqual(MAX_ROLE_TAGS_PER_LINK);
    for (const tag of CONTACT_ROLE_SUGGESTIONS) {
      expect(tag.length).toBeLessThanOrEqual(MAX_ROLE_TAG_LENGTH);
    }
  });
});

describe("contactEntityHref", () => {
  it("prefers the slug for clients and projects", () => {
    expect(contactEntityHref("client", { id: "c1", slug: "acme" })).toBe("/clients/acme");
    expect(contactEntityHref("project", { id: "p1", slug: "hq-buildout" })).toBe(
      "/projects/hq-buildout"
    );
  });

  it("falls back to the id when a client/project has no slug", () => {
    expect(contactEntityHref("client", { id: "c1", slug: null })).toBe("/clients/c1");
    expect(contactEntityHref("project", { id: "p1" })).toBe("/projects/p1");
  });

  it("uses id-only hrefs for the other types", () => {
    expect(contactEntityHref("supplier", { id: "s1" })).toBe("/suppliers/s1");
    expect(contactEntityHref("subcontractor", { id: "x1" })).toBe("/subcontractors/x1");
    expect(contactEntityHref("partnership", { id: "pa1" })).toBe("/partnerships/pa1");
    expect(contactEntityHref("bid", { id: "b1" })).toBe("/bids/b1");
    expect(contactEntityHref("contract", { id: "k1" })).toBe("/contracts/k1");
  });
});

describe("resolveLinkTargets", () => {
  it("batches one query per entity type and skips dangling targets", async () => {
    dbMock.client.findMany.mockResolvedValue([{ id: "c1", name: "Acme", slug: "acme" }]);
    dbMock.bidOpportunity.findMany.mockResolvedValue([{ id: "b1", title: "City RFP" }]);

    const resolved = await resolveLinkTargets([
      { entityType: "client", entityId: "c1" },
      { entityType: "client", entityId: "c-deleted" }, // soft-deleted → not returned
      { entityType: "bid", entityId: "b1" },
      { entityType: "unknown-type", entityId: "z1" }, // outside the closed set
    ]);

    expect(dbMock.client.findMany).toHaveBeenCalledTimes(1);
    expect(dbMock.bidOpportunity.findMany).toHaveBeenCalledTimes(1);
    // Soft-deleted rows are excluded in SQL.
    expect(dbMock.client.findMany.mock.calls[0][0].where).toEqual({
      id: { in: ["c1", "c-deleted"] },
      deletedAt: null,
    });

    expect(resolved.get(linkTargetKey("client", "c1"))).toEqual({
      name: "Acme",
      href: "/clients/acme",
    });
    expect(resolved.get(linkTargetKey("bid", "b1"))).toEqual({
      name: "City RFP",
      href: "/bids/b1",
    });
    expect(resolved.has(linkTargetKey("client", "c-deleted"))).toBe(false);
    expect(resolved.has(linkTargetKey("unknown-type", "z1"))).toBe(false);
  });

  it("returns an empty map for no links without touching the db", async () => {
    const resolved = await resolveLinkTargets([]);
    expect(resolved.size).toBe(0);
    expect(dbMock.client.findMany).not.toHaveBeenCalled();
  });
});
