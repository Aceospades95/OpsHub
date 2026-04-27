import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Prisma client before importing the module under test so the
// module's static `import { db } from "@/lib/db"` picks up the mock.
vi.mock("@/lib/db", () => ({
  db: {
    quote: {
      findFirst: vi.fn(),
    },
  },
}));

import { db } from "@/lib/db";
import { nextQuoteNumber } from "./numbering";

const findFirst = db.quote.findFirst as ReturnType<typeof vi.fn>;

describe("nextQuoteNumber", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("strips non-alphanumerics from the client name and joins them", async () => {
    findFirst.mockResolvedValue(null);
    const number = await nextQuoteNumber(
      "Acme Corp",
      null,
      new Date(Date.UTC(2026, 0, 1))
    );
    expect(number).toBe("ACMECORP-2026-0001");
  });

  it("includes the project slug when one is supplied", async () => {
    findFirst.mockResolvedValue(null);
    const number = await nextQuoteNumber(
      "Acme",
      "Marketing Site",
      new Date(Date.UTC(2026, 5, 15))
    );
    expect(number).toBe("ACME-MARKETINGSIT-2026-0001");
  });

  it("caps each slug at 12 characters", async () => {
    findFirst.mockResolvedValue(null);
    const number = await nextQuoteNumber(
      "Beta Industries Holdings International",
      null,
      new Date(Date.UTC(2026, 0, 1))
    );
    // "BETAINDUSTRIESHOLDINGS..." → first 12 alphanumerics
    expect(number).toBe("BETAINDUSTRI-2026-0001");
  });

  it("increments the trailing counter by parsing the latest year quote", async () => {
    findFirst.mockResolvedValue({ quoteNumber: "ACME-2026-0042" });
    const number = await nextQuoteNumber(
      "Acme",
      null,
      new Date(Date.UTC(2026, 5, 15))
    );
    expect(number).toBe("ACME-2026-0043");
  });

  it("counter is global across clients (Beta starts above Acme's last)", async () => {
    findFirst.mockResolvedValue({ quoteNumber: "ACME-2026-0007" });
    const number = await nextQuoteNumber(
      "Beta",
      null,
      new Date(Date.UTC(2026, 5, 15))
    );
    expect(number).toBe("BETA-2026-0008");
  });

  it("isolates numbering by year (2027 starts fresh at 0001)", async () => {
    findFirst.mockResolvedValueOnce(null);
    const a = await nextQuoteNumber(
      "Acme",
      null,
      new Date(Date.UTC(2027, 0, 1))
    );
    expect(a).toBe("ACME-2027-0001");
  });

  it("falls back to a placeholder slug when the name has no alphanumerics", async () => {
    findFirst.mockResolvedValue(null);
    const number = await nextQuoteNumber(
      "🎉🎉🎉",
      null,
      new Date(Date.UTC(2026, 0, 1))
    );
    expect(number).toBe("Q-2026-0001");
  });

  it("zero-pads to four digits and grows past 9999", async () => {
    findFirst.mockResolvedValue({ quoteNumber: "ACME-2026-9999" });
    const number = await nextQuoteNumber(
      "Acme",
      null,
      new Date(Date.UTC(2026, 11, 31))
    );
    expect(number).toBe("ACME-2026-10000");
  });
});
