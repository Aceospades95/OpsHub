/**
 * Quote totals math. Pure functions — no DB, no Prisma types — so the
 * editor's live preview, the server-action save path, and the renderer for
 * the public quote page can all share one implementation.
 *
 * The order of operations matches what the client sees on the public view:
 *
 *   1. For each line item: rowSubtotal = qty * unitPrice, then apply the
 *      row's own discount (PERCENT or FIXED).
 *   2. Optional rows that aren't selected contribute zero.
 *   3. Quote subtotal = sum of selected row subtotals.
 *   4. Apply the quote-level discount on top of subtotal.
 *   5. Tax is applied to (subtotal - quote discount). Null taxRate means
 *      tax-exempt — taxAmount = 0 and the public view hides the tax line.
 *   6. Total = subtotal - discount + tax.
 *
 * Currency rounding: callers store Floats. We round to 2 decimal places at
 * each visible boundary so the displayed value matches what's persisted.
 */

export type DiscountType = "NONE" | "PERCENT" | "FIXED";

export interface LineItemInput {
  quantity: number;
  unitPrice: number;
  discountType?: DiscountType;
  discountValue?: number;
  isOptional?: boolean;
  isSelected?: boolean;
}

export interface QuoteTotalsInput {
  lineItems: LineItemInput[];
  discountType?: DiscountType;
  discountValue?: number;
  /** Tax rate as a percentage (e.g. 8.25 for 8.25%). Null = tax-exempt. */
  taxRate?: number | null;
}

export interface LineSubtotal {
  /** Raw row total (qty * unitPrice) before discount, before optional gating. */
  raw: number;
  /** Final row contribution to the quote subtotal (after discount; 0 if
   *  the row is optional and not selected). */
  subtotal: number;
}

export interface QuoteTotalsOutput {
  /** Per-line subtotals in the same order as the input. */
  lineSubtotals: LineSubtotal[];
  /** Sum of selected line subtotals (after per-line discounts). */
  subtotal: number;
  /** Quote-level discount amount (always >= 0). */
  discountAmount: number;
  /** Tax amount; 0 when taxRate is null/undefined. */
  taxAmount: number;
  /** Final total after discount and tax. */
  total: number;
}

function round2(n: number): number {
  // Add a tiny epsilon to push values exactly at the .005 boundary up,
  // matching how most currency formatters round half-up. JS's default
  // banker's rounding would produce "2.50" → 2 instead of 3 for .015.
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function applyDiscount(amount: number, type: DiscountType, value: number): number {
  if (type === "PERCENT") {
    const pct = Math.max(0, Math.min(100, value));
    return amount * (1 - pct / 100);
  }
  if (type === "FIXED") {
    return Math.max(0, amount - Math.max(0, value));
  }
  return amount;
}

export function computeLineSubtotal(item: LineItemInput): LineSubtotal {
  const qty = Number.isFinite(item.quantity) ? item.quantity : 0;
  const price = Number.isFinite(item.unitPrice) ? item.unitPrice : 0;
  const raw = round2(qty * price);

  const isSelected = item.isOptional ? item.isSelected !== false : true;
  if (!isSelected) return { raw, subtotal: 0 };

  const discounted = applyDiscount(
    raw,
    item.discountType ?? "NONE",
    item.discountValue ?? 0
  );
  return { raw, subtotal: round2(Math.max(0, discounted)) };
}

export function computeQuoteTotals(input: QuoteTotalsInput): QuoteTotalsOutput {
  const lineSubtotals = input.lineItems.map(computeLineSubtotal);
  const subtotal = round2(
    lineSubtotals.reduce((acc, l) => acc + l.subtotal, 0)
  );

  const discountedSubtotal = applyDiscount(
    subtotal,
    input.discountType ?? "NONE",
    input.discountValue ?? 0
  );
  const discountAmount = round2(Math.max(0, subtotal - discountedSubtotal));

  const taxBase = Math.max(0, subtotal - discountAmount);
  const taxAmount =
    input.taxRate == null
      ? 0
      : round2(taxBase * (Math.max(0, input.taxRate) / 100));

  const total = round2(taxBase + taxAmount);

  return { lineSubtotals, subtotal, discountAmount, taxAmount, total };
}

/** Format a Float currency amount with the project's `Intl.NumberFormat` style. */
export function formatCurrency(amount: number, currency: string = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    // Unknown ISO currency — fall back to the code prefix so the UI
    // still renders something sensible instead of throwing.
    return `${currency} ${amount.toFixed(2)}`;
  }
}
