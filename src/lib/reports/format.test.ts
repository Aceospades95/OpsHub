import { describe, it, expect } from "vitest";

import { renderCsv } from "./format";
import type { ReportOutput } from "./types";

function report(rows: Record<string, unknown>[]): ReportOutput {
  return {
    summary: "test",
    columns: [{ key: "value", label: "Value" }],
    rows,
  } as ReportOutput;
}

/** First data line of the rendered CSV (after the header row). */
function firstCell(rows: Record<string, unknown>[]): string {
  return renderCsv(report(rows)).split("\r\n")[1];
}

describe("renderCsv — spreadsheet-formula injection", () => {
  it.each([
    ["=1+1", "'=1+1"],
    ["=cmd|' /C calc'!A0", "'=cmd|' /C calc'!A0"],
    ["+SUM(A1:A9)", "'+SUM(A1:A9)"],
    ["-2+3", "'-2+3"],
    ["@SUM(A1)", "'@SUM(A1)"],
    ["\tleading tab", "'\tleading tab"],
  ])("neutralizes %j with a leading single quote", (input, expected) => {
    expect(firstCell([{ value: input }])).toBe(expected);
  });

  it("leaves pure numbers unprefixed so spreadsheets keep parsing them as numbers", () => {
    expect(firstCell([{ value: "-12.5" }])).toBe("-12.5");
    expect(firstCell([{ value: "-7" }])).toBe("-7");
    expect(firstCell([{ value: -12.5 }])).toBe("-12.5");
    expect(firstCell([{ value: 42 }])).toBe("42");
  });

  it("leaves ordinary text untouched", () => {
    expect(firstCell([{ value: "Acme Corp" }])).toBe("Acme Corp");
    expect(firstCell([{ value: "" }])).toBe("");
  });

  it("still applies RFC-4180 quoting on top of the formula guard", () => {
    expect(firstCell([{ value: '=HYPERLINK("x","y")' }])).toBe(
      `"'=HYPERLINK(""x"",""y"")"`
    );
    expect(firstCell([{ value: "a,b" }])).toBe(`"a,b"`);
  });
});
