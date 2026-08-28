import { describe, it, expect } from "vitest";
import {
  computeLineSubtotal,
  computeQuoteTotals,
  formatCurrency,
} from "./totals";

describe("computeLineSubtotal", () => {
  it("multiplies quantity by unit price", () => {
    const r = computeLineSubtotal({ quantity: 3, unitPrice: 100 });
    expect(r.raw).toBe(300);
    expect(r.subtotal).toBe(300);
  });

  it("applies a percent discount to the row", () => {
    const r = computeLineSubtotal({
      quantity: 1,
      unitPrice: 100,
      discountType: "PERCENT",
      discountValue: 25,
    });
    expect(r.subtotal).toBe(75);
  });

  it("applies a fixed discount to the row, never going below zero", () => {
    const a = computeLineSubtotal({
      quantity: 1,
      unitPrice: 100,
      discountType: "FIXED",
      discountValue: 30,
    });
    expect(a.subtotal).toBe(70);

    const b = computeLineSubtotal({
      quantity: 1,
      unitPrice: 50,
      discountType: "FIXED",
      discountValue: 100,
    });
    expect(b.subtotal).toBe(0);
  });

  it("optional + selected behaves like a regular row", () => {
    const r = computeLineSubtotal({
      quantity: 2,
      unitPrice: 50,
      isOptional: true,
      isSelected: true,
    });
    expect(r.subtotal).toBe(100);
  });

  it("optional + unselected contributes zero but raw is still computed", () => {
    const r = computeLineSubtotal({
      quantity: 2,
      unitPrice: 50,
      isOptional: true,
      isSelected: false,
    });
    expect(r.raw).toBe(100);
    expect(r.subtotal).toBe(0);
  });

  it("treats NaN inputs as zero so the editor doesn't crash on empty fields", () => {
    const r = computeLineSubtotal({
      quantity: Number.NaN,
      unitPrice: 100,
    });
    expect(r.subtotal).toBe(0);
  });

  it("clamps a percent discount above 100% to free", () => {
    const r = computeLineSubtotal({
      quantity: 1,
      unitPrice: 200,
      discountType: "PERCENT",
      discountValue: 150,
    });
    expect(r.subtotal).toBe(0);
  });
});

describe("computeQuoteTotals", () => {
  it("sums line subtotals into a quote subtotal", () => {
    const t = computeQuoteTotals({
      lineItems: [
        { quantity: 1, unitPrice: 100 },
        { quantity: 2, unitPrice: 50 },
      ],
    });
    expect(t.subtotal).toBe(200);
    expect(t.total).toBe(200);
    expect(t.taxAmount).toBe(0);
    expect(t.discountAmount).toBe(0);
  });

  it("excludes unselected optional rows from the subtotal", () => {
    const t = computeQuoteTotals({
      lineItems: [
        { quantity: 1, unitPrice: 100 },
        { quantity: 1, unitPrice: 50, isOptional: true, isSelected: false },
      ],
    });
    expect(t.subtotal).toBe(100);
  });

  it("applies a quote-level percent discount before tax", () => {
    const t = computeQuoteTotals({
      lineItems: [{ quantity: 1, unitPrice: 100 }],
      discountType: "PERCENT",
      discountValue: 10,
      taxRate: 10,
    });
    expect(t.subtotal).toBe(100);
    expect(t.discountAmount).toBe(10);
    expect(t.taxAmount).toBe(9);
    expect(t.total).toBe(99);
  });

  it("applies a quote-level fixed discount", () => {
    const t = computeQuoteTotals({
      lineItems: [{ quantity: 1, unitPrice: 100 }],
      discountType: "FIXED",
      discountValue: 25,
    });
    expect(t.discountAmount).toBe(25);
    expect(t.total).toBe(75);
  });

  it("treats null taxRate as tax-exempt and produces zero tax", () => {
    const t = computeQuoteTotals({
      lineItems: [{ quantity: 1, unitPrice: 100 }],
      taxRate: null,
    });
    expect(t.taxAmount).toBe(0);
    expect(t.total).toBe(100);
  });

  it("applies tax to the post-discount base", () => {
    const t = computeQuoteTotals({
      lineItems: [{ quantity: 1, unitPrice: 200 }],
      discountType: "PERCENT",
      discountValue: 50,
      taxRate: 10,
    });
    expect(t.subtotal).toBe(200);
    expect(t.discountAmount).toBe(100);
    expect(t.taxAmount).toBe(10); // 10% of 100
    expect(t.total).toBe(110);
  });

  it("handles row-level + quote-level discounts together", () => {
    const t = computeQuoteTotals({
      lineItems: [
        {
          quantity: 1,
          unitPrice: 100,
          discountType: "PERCENT",
          discountValue: 10, // row → 90
        },
      ],
      discountType: "PERCENT",
      discountValue: 10, // quote → 81
      taxRate: null,
    });
    expect(t.subtotal).toBe(90);
    expect(t.discountAmount).toBe(9);
    expect(t.total).toBe(81);
  });

  it("rounds to 2 decimal places", () => {
    const t = computeQuoteTotals({
      lineItems: [{ quantity: 3, unitPrice: 33.333 }],
    });
    expect(t.subtotal).toBe(100.0);
    expect(t.total).toBe(100.0);
  });
});

describe("formatCurrency", () => {
  it("formats USD amounts with the dollar sign", () => {
    expect(formatCurrency(1234.5, "USD")).toBe("$1,234.50");
  });

  it("falls back gracefully for unknown currency codes", () => {
    expect(formatCurrency(50, "ZZZ")).toContain("50.00");
  });

  it("formats compact KPI amounts as $48.8M-style", () => {
    expect(formatCurrency(48795000, "USD", { compact: true })).toBe("$48.8M");
    expect(formatCurrency(1250, "USD", { compact: true })).toBe("$1.3K");
    expect(formatCurrency(950, "USD", { compact: true })).toBe("$950");
  });

  it("keeps full precision when compact is not requested", () => {
    expect(formatCurrency(48795000, "USD")).toBe("$48,795,000.00");
  });
});
