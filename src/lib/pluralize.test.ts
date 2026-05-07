import { describe, it, expect } from "vitest";
import { pluralize, pluralizeWord } from "./pluralize";

describe("pluralize", () => {
  it("singular when count is 1", () => {
    expect(pluralize(1, "project")).toBe("1 project");
    expect(pluralize(1, "task")).toBe("1 task");
  });

  it("default-plural (suffix s) when count !== 1", () => {
    expect(pluralize(0, "project")).toBe("0 projects");
    expect(pluralize(2, "task")).toBe("2 tasks");
    expect(pluralize(99, "client")).toBe("99 clients");
  });

  it("uses explicit plural for irregulars", () => {
    expect(pluralize(0, "person", "people")).toBe("0 people");
    expect(pluralize(1, "person", "people")).toBe("1 person");
    expect(pluralize(2, "person", "people")).toBe("2 people");
    expect(pluralize(2, "ally", "allies")).toBe("2 allies");
  });
});

describe("pluralizeWord", () => {
  it("returns just the word, pluralized when needed", () => {
    expect(pluralizeWord(1, "task")).toBe("task");
    expect(pluralizeWord(2, "task")).toBe("tasks");
    expect(pluralizeWord(0, "ally", "allies")).toBe("allies");
  });
});
