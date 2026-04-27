/**
 * Quote PDF rendering via @react-pdf/renderer.
 *
 * Why react-pdf instead of Puppeteer:
 *   - No headless Chromium dependency (Puppeteer adds ~150MB to the
 *     container image and a binary that doesn't ship with the standalone
 *     Next build by default).
 *   - Pure JS — works inside the existing route handler with no shell-out.
 *   - Pixel-stable output across environments, which matters for legally
 *     binding documents.
 *
 * Layout matches the public quote page so what the recipient sees on
 * screen is what they get in the PDF — same line items, totals, and
 * terms text. Colour palette is intentionally muted (neutral grays only)
 * so the PDF prints clean on both colour and B&W printers.
 */

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import React from "react";
import { formatCurrency } from "./totals";

export interface QuotePdfLineItem {
  name: string;
  description: string | null;
  groupLabel: string | null;
  quantity: number;
  unit: string | null;
  unitPrice: number;
  subtotal: number;
  isOptional: boolean;
  isSelected: boolean;
  isRecurring: boolean;
  recurringInterval: "MONTHLY" | "QUARTERLY" | "ANNUALLY" | null;
}

export interface QuotePdfData {
  quoteNumber: string;
  title: string;
  status: string;
  introText: string | null;
  termsText: string | null;
  currency: string;
  taxRate: number | null;
  validUntil: Date | null;
  acceptedAt: Date | null;
  acceptedSignatureName: string | null;
  clientName: string;
  /** Display name shown in the company header — falls back to "OpsHub". */
  companyName: string | null;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  total: number;
  lineItems: QuotePdfLineItem[];
}

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    padding: 40,
    color: "#1a1a1a",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingBottom: 16,
    marginBottom: 24,
    borderBottom: "1pt solid #e5e5e5",
  },
  companyName: {
    fontSize: 14,
    fontWeight: 600,
    color: "#1a1a1a",
  },
  quoteNumber: {
    fontSize: 9,
    color: "#888",
    fontFamily: "Courier",
  },
  title: {
    fontSize: 18,
    fontWeight: 700,
    marginBottom: 4,
  },
  meta: {
    fontSize: 9,
    color: "#666",
    marginBottom: 16,
  },
  intro: {
    fontSize: 10,
    color: "#333",
    marginBottom: 20,
    lineHeight: 1.5,
  },
  groupHeading: {
    fontSize: 9,
    color: "#666",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 16,
    marginBottom: 6,
  },
  table: {
    borderTop: "1pt solid #e5e5e5",
  },
  row: {
    flexDirection: "row",
    paddingVertical: 8,
    borderBottom: "1pt solid #e5e5e5",
  },
  rowDimmed: {
    opacity: 0.5,
  },
  cellName: { flexBasis: "55%", paddingRight: 8 },
  cellQty: { flexBasis: "10%", textAlign: "right" },
  cellPrice: { flexBasis: "15%", textAlign: "right" },
  cellAmount: { flexBasis: "20%", textAlign: "right", fontWeight: 600 },
  itemName: { fontSize: 10, fontWeight: 600 },
  itemDescription: { fontSize: 8.5, color: "#666", marginTop: 2 },
  itemMeta: { fontSize: 8, color: "#888", marginTop: 2 },
  totals: {
    marginTop: 16,
    marginLeft: "auto",
    width: 220,
  },
  totalsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
  },
  totalsRowFinal: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 6,
    marginTop: 4,
    borderTop: "1pt solid #1a1a1a",
    fontSize: 13,
    fontWeight: 700,
  },
  terms: {
    marginTop: 32,
    paddingTop: 12,
    borderTop: "1pt solid #e5e5e5",
    fontSize: 8.5,
    color: "#555",
    lineHeight: 1.5,
  },
  signature: {
    marginTop: 24,
    paddingTop: 12,
    borderTop: "1pt solid #e5e5e5",
    fontSize: 9,
    color: "#333",
  },
  expiredBanner: {
    backgroundColor: "#fef3c7",
    color: "#92400e",
    padding: 8,
    fontSize: 9,
    marginBottom: 16,
  },
  acceptedBanner: {
    backgroundColor: "#d1fae5",
    color: "#065f46",
    padding: 8,
    fontSize: 9,
    marginBottom: 16,
  },
});

function QuoteDocument({ data }: { data: QuotePdfData }) {
  // Group items by groupLabel for visually distinct sections.
  const groups: { label: string | null; items: QuotePdfLineItem[] }[] = [];
  for (const li of data.lineItems) {
    const last = groups[groups.length - 1];
    if (last && last.label === li.groupLabel) {
      last.items.push(li);
    } else {
      groups.push({ label: li.groupLabel, items: [li] });
    }
  }

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.companyName}>
            {data.companyName ?? "OpsHub"}
          </Text>
          <Text style={styles.quoteNumber}>{data.quoteNumber}</Text>
        </View>

        {data.status === "ACCEPTED" && (
          <Text style={styles.acceptedBanner}>
            Accepted{data.acceptedAt
              ? ` on ${data.acceptedAt.toLocaleDateString()}`
              : ""}
            {data.acceptedSignatureName
              ? ` by ${data.acceptedSignatureName}`
              : ""}
          </Text>
        )}
        {data.status === "EXPIRED" && (
          <Text style={styles.expiredBanner}>
            This quote has expired.
          </Text>
        )}

        <Text style={styles.title}>{data.title}</Text>
        <Text style={styles.meta}>
          Prepared for {data.clientName}
          {data.validUntil
            ? ` · Valid until ${data.validUntil.toLocaleDateString()}`
            : ""}
        </Text>

        {data.introText && <Text style={styles.intro}>{data.introText}</Text>}

        {groups.map((g, idx) => (
          <View key={idx}>
            {g.label && <Text style={styles.groupHeading}>{g.label}</Text>}
            <View style={styles.table}>
              {g.items.map((li, i) => {
                const dimmed = li.isOptional && !li.isSelected;
                return (
                  <View
                    key={i}
                    style={[styles.row, dimmed ? styles.rowDimmed : {}]}
                    wrap={false}
                  >
                    <View style={styles.cellName}>
                      <Text style={styles.itemName}>{li.name}</Text>
                      {li.description && (
                        <Text style={styles.itemDescription}>
                          {li.description}
                        </Text>
                      )}
                      <Text style={styles.itemMeta}>
                        {li.isOptional ? "Optional · " : ""}
                        {li.isRecurring
                          ? `${(li.recurringInterval ?? "RECURRING").toLowerCase()} · `
                          : ""}
                        {li.quantity}
                        {li.unit ? ` ${li.unit}` : ""} ×{" "}
                        {formatCurrency(li.unitPrice, data.currency)}
                      </Text>
                    </View>
                    <Text style={styles.cellQty}>{li.quantity}</Text>
                    <Text style={styles.cellPrice}>
                      {formatCurrency(li.unitPrice, data.currency)}
                    </Text>
                    <Text style={styles.cellAmount}>
                      {formatCurrency(li.subtotal, data.currency)}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>
        ))}

        <View style={styles.totals}>
          <View style={styles.totalsRow}>
            <Text>Subtotal</Text>
            <Text>{formatCurrency(data.subtotal, data.currency)}</Text>
          </View>
          {data.discountAmount > 0 && (
            <View style={styles.totalsRow}>
              <Text>Discount</Text>
              <Text>−{formatCurrency(data.discountAmount, data.currency)}</Text>
            </View>
          )}
          {data.taxRate != null && (
            <View style={styles.totalsRow}>
              <Text>Tax ({data.taxRate}%)</Text>
              <Text>{formatCurrency(data.taxAmount, data.currency)}</Text>
            </View>
          )}
          <View style={styles.totalsRowFinal}>
            <Text>Total</Text>
            <Text>{formatCurrency(data.total, data.currency)}</Text>
          </View>
        </View>

        {data.termsText && <Text style={styles.terms}>{data.termsText}</Text>}

        {data.acceptedAt && data.acceptedSignatureName && (
          <Text style={styles.signature}>
            Signed by {data.acceptedSignatureName} on{" "}
            {data.acceptedAt.toLocaleDateString()}.
          </Text>
        )}
      </Page>
    </Document>
  );
}

/**
 * Render a quote to a PDF Buffer. Safe to call from a Node-runtime route
 * handler. Returns the bytes — the caller is responsible for the response
 * headers (Content-Type, Content-Disposition).
 */
export async function renderQuotePdf(data: QuotePdfData): Promise<Buffer> {
  return renderToBuffer(<QuoteDocument data={data} />);
}
