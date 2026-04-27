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

describe("nextQuoteNumber", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts at 0001 when no quotes exist for the current year", async () => {
    (db.quote.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const number = await nextQuoteNumber(new Date(Date.UTC(2026, 0, 1)));
    expect(number).toBe("Q-2026-0001");
  });

  it("increments the highest existing number for the year", async () => {
    (db.quote.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      quoteNumber: "Q-2026-0042",
    });
    const number = await nextQuoteNumber(new Date(Date.UTC(2026, 5, 15)));
    expect(number).toBe("Q-2026-0043");
  });

  it("zero-pads to four digits even past 9999", async () => {
    (db.quote.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      quoteNumber: "Q-2026-9999",
    });
    const number = await nextQuoteNumber(new Date(Date.UTC(2026, 11, 31)));
    expect(number).toBe("Q-2026-10000");
  });

  it("isolates numbering by year", async () => {
    (db.quote.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const a = await nextQuoteNumber(new Date(Date.UTC(2026, 0, 1)));
    const b = await nextQuoteNumber(new Date(Date.UTC(2027, 0, 1)));
    expect(a).toBe("Q-2026-0001");
    expect(b).toBe("Q-2027-0001");
  });
});
