import { describe, it, expect, vi } from "vitest";

// Mock @/lib/db before importing the module under test — index.ts
// re-exports the registry, which pulls in every importer's static
// `import { db } from "@/lib/db"`.
vi.mock("@/lib/db", () => ({ db: {} }));

import { generateExportCsv } from "./index";
import type { ImporterDefinition } from "./types";

function fakeImporter(rows: Record<string, string>[]): ImporterDefinition {
  return {
    key: "fake",
    name: "Fakes",
    description: "test importer",
    fields: [
      { key: "name", label: "Name", required: true },
      { key: "note", label: "Note", required: false },
    ],
    commit: async () => ({ created: 0, updated: 0, failed: 0, results: [] }),
    exportRows: async () => rows,
  } as unknown as ImporterDefinition;
}

describe("generateExportCsv — spreadsheet-formula injection", () => {
  it("neutralizes leading =, +, -, @ with a single quote", async () => {
    const csv = await generateExportCsv(
      fakeImporter([
        { name: "=1+1", note: "+SUM(A1)" },
        { name: "@cmd", note: "-2+3" },
      ])
    );
    const lines = csv!.trimEnd().split("\r\n");
    expect(lines[1]).toBe("'=1+1,'+SUM(A1)");
    expect(lines[2]).toBe("'@cmd,'-2+3");
  });

  it("leaves pure numbers and plain text untouched", async () => {
    const csv = await generateExportCsv(
      fakeImporter([{ name: "Acme Corp", note: "-12.5" }])
    );
    expect(csv!.trimEnd().split("\r\n")[1]).toBe("Acme Corp,-12.5");
  });

  it("still applies RFC-4180 quoting on top of the formula guard", async () => {
    const csv = await generateExportCsv(
      fakeImporter([{ name: '=HYPERLINK("x")', note: "a,b" }])
    );
    expect(csv!.trimEnd().split("\r\n")[1]).toBe(
      `"'=HYPERLINK(""x"")","a,b"`
    );
  });

  it("returns null for importers without exportRows()", async () => {
    const importer = fakeImporter([]);
    delete (importer as { exportRows?: unknown }).exportRows;
    expect(await generateExportCsv(importer)).toBeNull();
  });
});
