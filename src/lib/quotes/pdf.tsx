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
 * Design: a branded proposal document — accent-colored header band with
 * the company logo, label/value meta grid, a real line-item table
 * (accent header row, zebra striping, right-aligned numerics), a tinted
 * totals card, titled sections for assumptions/terms, and a fixed footer
 * with page numbers on every page.
 *
 * THEMING — the accent color comes from the branding settings
 * (`branding.accentColor`, editable at /admin/theme) with the Wynndalco
 * green as the default. All accent-derived tints are computed from that
 * one hex so a rebrand is a single admin edit, no code change. The
 * renderer itself stays modular: `QuoteDocument` is a pure component of
 * (data, theme), so alternative templates later are "another component
 * + a template picker", not a rewrite.
 */

import {
  Document,
  Image,
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
  assumptionsText: string | null;
  termsText: string | null;
  currency: string;
  taxRate: number | null;
  validUntil: Date | null;
  acceptedAt: Date | null;
  acceptedSignatureName: string | null;
  clientName: string;
  /** Display name shown in the company header — falls back to "OpsHub". */
  companyName: string | null;
  /** Public-storage URL of the company logo (used by HTML surfaces). */
  companyLogoUrl: string | null;
  /**
   * Raw logo bytes for embedding into the PDF — react-pdf can't fetch
   * the app-relative `/api/files/…` URL from inside the renderer, so
   * the loader reads the file through the storage driver instead.
   * Only png/jpg render; other formats fall back to the company name.
   */
  companyLogo: { data: Buffer; format: "png" | "jpg" } | null;
  /** Brand accent hex (e.g. "#166534"). Null → default Wynndalco green. */
  accentColor: string | null;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  total: number;
  lineItems: QuotePdfLineItem[];
}

/** Wynndalco corporate green — overridden by branding.accentColor. */
const DEFAULT_ACCENT = "#166534";

/** Blend a hex color toward white; factor 0 = color, 1 = white. */
function tint(hex: string, factor: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const mix = (c: number) => Math.round(c + (255 - c) * factor);
  const r = mix((n >> 16) & 0xff);
  const g = mix((n >> 8) & 0xff);
  const b = mix(n & 0xff);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

function buildStyles(accent: string) {
  return StyleSheet.create({
    page: {
      fontFamily: "Helvetica",
      fontSize: 9.5,
      paddingTop: 44,
      paddingBottom: 64,
      paddingHorizontal: 48,
      color: "#1f2427",
    },
    // Accent band across the very top of every page.
    topBand: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      height: 8,
      backgroundColor: accent,
    },
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      marginBottom: 22,
    },
    logo: {
      height: 34,
      maxWidth: 190,
      objectFit: "contain",
    },
    companyName: {
      fontSize: 16,
      fontFamily: "Helvetica-Bold",
      color: "#1f2427",
    },
    docLabel: {
      fontSize: 9,
      letterSpacing: 2,
      color: accent,
      fontFamily: "Helvetica-Bold",
      textAlign: "right",
      marginBottom: 3,
    },
    quoteNumber: {
      fontSize: 10,
      color: "#5b6470",
      textAlign: "right",
      fontFamily: "Courier",
    },
    title: {
      fontSize: 20,
      fontFamily: "Helvetica-Bold",
      color: "#14181b",
      marginBottom: 14,
      lineHeight: 1.25,
    },
    metaGrid: {
      flexDirection: "row",
      gap: 18,
      paddingVertical: 12,
      borderTop: `1pt solid ${tint(accent, 0.75)}`,
      borderBottom: `1pt solid ${tint(accent, 0.75)}`,
      marginBottom: 18,
    },
    metaCell: { flexGrow: 1 },
    metaLabel: {
      fontSize: 7,
      letterSpacing: 1.2,
      textTransform: "uppercase",
      color: "#7c8691",
      marginBottom: 3,
      fontFamily: "Helvetica-Bold",
    },
    metaValue: { fontSize: 10, color: "#1f2427" },
    intro: {
      fontSize: 9.5,
      color: "#3a4148",
      marginBottom: 18,
      lineHeight: 1.55,
    },
    groupHeading: {
      fontSize: 9,
      color: accent,
      fontFamily: "Helvetica-Bold",
      textTransform: "uppercase",
      letterSpacing: 1,
      marginTop: 14,
      marginBottom: 4,
      paddingLeft: 6,
      borderLeft: `2.5pt solid ${accent}`,
    },
    tableHeader: {
      flexDirection: "row",
      backgroundColor: accent,
      borderRadius: 3,
      paddingVertical: 6,
      paddingHorizontal: 8,
      marginBottom: 2,
    },
    th: {
      fontSize: 7.5,
      color: "#ffffff",
      fontFamily: "Helvetica-Bold",
      textTransform: "uppercase",
      letterSpacing: 0.8,
    },
    row: {
      flexDirection: "row",
      paddingVertical: 7,
      paddingHorizontal: 8,
      borderBottom: "0.75pt solid #e8ebee",
    },
    rowAlt: {
      backgroundColor: "#f7f9fa",
    },
    rowDimmed: {
      opacity: 0.45,
    },
    cellName: { flexBasis: "52%", paddingRight: 10 },
    cellQty: { flexBasis: "12%", textAlign: "right" },
    cellPrice: { flexBasis: "16%", textAlign: "right" },
    cellAmount: { flexBasis: "20%", textAlign: "right", fontFamily: "Helvetica-Bold" },
    itemName: { fontSize: 9.5, fontFamily: "Helvetica-Bold", color: "#1f2427" },
    itemDescription: { fontSize: 8, color: "#5b6470", marginTop: 2, lineHeight: 1.45 },
    itemMeta: { fontSize: 7.5, color: "#8a939e", marginTop: 2 },
    totals: {
      marginTop: 18,
      marginLeft: "auto",
      width: 230,
      backgroundColor: tint(accent, 0.93),
      borderRadius: 4,
      padding: 12,
    },
    totalsRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingVertical: 2.5,
      fontSize: 9,
      color: "#3a4148",
    },
    totalsRowFinal: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingTop: 7,
      marginTop: 5,
      borderTop: `1pt solid ${tint(accent, 0.45)}`,
      fontSize: 13,
      fontFamily: "Helvetica-Bold",
      color: accent,
    },
    section: { marginTop: 20 },
    sectionTitle: {
      fontSize: 9,
      color: accent,
      fontFamily: "Helvetica-Bold",
      textTransform: "uppercase",
      letterSpacing: 1,
      marginBottom: 5,
      paddingBottom: 3,
      borderBottom: `1pt solid ${tint(accent, 0.75)}`,
    },
    sectionBody: {
      fontSize: 8.5,
      color: "#4a525a",
      lineHeight: 1.55,
    },
    signature: {
      marginTop: 22,
      padding: 10,
      backgroundColor: "#f2fbf5",
      borderRadius: 4,
      fontSize: 9,
      color: "#14532d",
    },
    banner: {
      padding: 9,
      fontSize: 9,
      marginBottom: 14,
      borderRadius: 4,
      fontFamily: "Helvetica-Bold",
    },
    acceptedBanner: { backgroundColor: "#d1fae5", color: "#065f46" },
    expiredBanner: { backgroundColor: "#fef3c7", color: "#92400e" },
    footer: {
      position: "absolute",
      left: 48,
      right: 48,
      bottom: 24,
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingTop: 8,
      borderTop: `1pt solid ${tint(accent, 0.7)}`,
      fontSize: 7.5,
      color: "#7c8691",
    },
  });
}

function QuoteDocument({ data }: { data: QuotePdfData }) {
  const accent = data.accentColor && /^#?[0-9a-f]{6}$/i.test(data.accentColor.trim())
    ? (data.accentColor.trim().startsWith("#") ? data.accentColor.trim() : `#${data.accentColor.trim()}`)
    : DEFAULT_ACCENT;
  const styles = buildStyles(accent);
  const companyLabel = data.companyName ?? "OpsHub";

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

  const tableHead = (
    <View style={styles.tableHeader}>
      <Text style={[styles.th, { flexBasis: "52%" }]}>Description</Text>
      <Text style={[styles.th, { flexBasis: "12%", textAlign: "right" }]}>Qty</Text>
      <Text style={[styles.th, { flexBasis: "16%", textAlign: "right" }]}>Unit price</Text>
      <Text style={[styles.th, { flexBasis: "20%", textAlign: "right" }]}>Amount</Text>
    </View>
  );

  return (
    <Document
      title={`${data.quoteNumber} — ${data.title}`}
      author={companyLabel}
      subject={`Quote for ${data.clientName}`}
    >
      <Page size="LETTER" style={styles.page}>
        <View style={styles.topBand} fixed />

        <View style={styles.header}>
          {data.companyLogo ? (
            // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt prop
            <Image
              style={styles.logo}
              src={{ data: data.companyLogo.data, format: data.companyLogo.format }}
            />
          ) : (
            <Text style={styles.companyName}>{companyLabel}</Text>
          )}
          <View>
            <Text style={styles.docLabel}>QUOTE</Text>
            <Text style={styles.quoteNumber}>{data.quoteNumber}</Text>
          </View>
        </View>

        {data.status === "ACCEPTED" && (
          <Text style={[styles.banner, styles.acceptedBanner]}>
            Accepted{data.acceptedAt ? ` on ${fmtDate(data.acceptedAt)}` : ""}
            {data.acceptedSignatureName ? ` by ${data.acceptedSignatureName}` : ""}
          </Text>
        )}
        {data.status === "EXPIRED" && (
          <Text style={[styles.banner, styles.expiredBanner]}>
            This quote has expired.
          </Text>
        )}

        <Text style={styles.title}>{data.title}</Text>

        <View style={styles.metaGrid}>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Prepared for</Text>
            <Text style={styles.metaValue}>{data.clientName}</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Prepared by</Text>
            <Text style={styles.metaValue}>{companyLabel}</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Quote no.</Text>
            <Text style={styles.metaValue}>{data.quoteNumber}</Text>
          </View>
          {data.validUntil && (
            <View style={styles.metaCell}>
              <Text style={styles.metaLabel}>Valid until</Text>
              <Text style={styles.metaValue}>{fmtDate(data.validUntil)}</Text>
            </View>
          )}
        </View>

        {data.introText && <Text style={styles.intro}>{data.introText}</Text>}

        {groups.map((g, idx) => (
          <View key={idx}>
            {g.label && <Text style={styles.groupHeading}>{g.label}</Text>}
            {(idx === 0 || g.label) && tableHead}
            {g.items.map((li, i) => {
              const dimmed = li.isOptional && !li.isSelected;
              return (
                <View
                  key={i}
                  style={[
                    styles.row,
                    ...(i % 2 === 1 ? [styles.rowAlt] : []),
                    ...(dimmed ? [styles.rowDimmed] : []),
                  ]}
                  wrap={false}
                >
                  <View style={styles.cellName}>
                    <Text style={styles.itemName}>{li.name}</Text>
                    {li.description && (
                      <Text style={styles.itemDescription}>{li.description}</Text>
                    )}
                    {(li.isOptional || li.isRecurring) && (
                      <Text style={styles.itemMeta}>
                        {li.isOptional ? "Optional" : ""}
                        {li.isOptional && li.isRecurring ? " · " : ""}
                        {li.isRecurring
                          ? `Billed ${(li.recurringInterval ?? "RECURRING").toLowerCase()}`
                          : ""}
                      </Text>
                    )}
                  </View>
                  <Text style={styles.cellQty}>
                    {li.quantity}
                    {li.unit ? ` ${li.unit}` : ""}
                  </Text>
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
        ))}

        <View style={styles.totals} wrap={false}>
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

        {data.assumptionsText && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Assumptions</Text>
            <Text style={styles.sectionBody}>{data.assumptionsText}</Text>
          </View>
        )}

        {data.termsText && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Terms & Conditions</Text>
            <Text style={styles.sectionBody}>{data.termsText}</Text>
          </View>
        )}

        {data.acceptedAt && data.acceptedSignatureName && (
          <Text style={styles.signature}>
            Signed by {data.acceptedSignatureName} on {fmtDate(data.acceptedAt)}.
          </Text>
        )}

        <View style={styles.footer} fixed>
          <Text>
            {companyLabel} · {data.quoteNumber}
          </Text>
          <Text
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          />
        </View>
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
