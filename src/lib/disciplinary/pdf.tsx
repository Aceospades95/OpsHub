/**
 * Disciplinary action report PDF via @react-pdf/renderer — same
 * rationale as the quote PDF (no Chromium, pure JS, print-stable). The
 * layout mirrors the old Google Spreadsheet template: header block,
 * incident details, action taken, improvement plan, and signature lines
 * for the employee and the issuer.
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
import { DISCIPLINARY_ACTION_LABELS } from "@/lib/disciplinary";
import type { DisciplinaryActionType } from "@prisma/client";

export interface DisciplinaryPdfData {
  companyName: string | null;
  employeeName: string;
  employeeJobTitle: string | null;
  employeeDepartment: string | null;
  issuedByName: string;
  actionType: DisciplinaryActionType;
  incidentDate: Date;
  reportDate: Date;
  description: string;
  actionTaken: string | null;
  improvementPlan: string | null;
  witnesses: string | null;
  followUpDate: Date | null;
  acknowledgedAt: Date | null;
}

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    padding: 48,
    color: "#1a1a1a",
  },
  companyName: { fontSize: 13, fontWeight: 700 },
  title: {
    fontSize: 16,
    fontWeight: 700,
    marginTop: 4,
    marginBottom: 18,
  },
  metaTable: {
    borderTop: "1pt solid #d4d4d4",
    borderBottom: "1pt solid #d4d4d4",
    paddingVertical: 8,
    marginBottom: 18,
  },
  metaRow: { flexDirection: "row", paddingVertical: 2 },
  metaLabel: { width: 130, color: "#555555", fontSize: 9 },
  metaValue: { flex: 1, fontSize: 10 },
  sectionHeading: {
    fontSize: 11,
    fontWeight: 700,
    marginBottom: 4,
    marginTop: 12,
  },
  body: { lineHeight: 1.5, whiteSpace: "pre-wrap" as never },
  signatureBlock: {
    marginTop: 42,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 24,
  },
  signature: { flex: 1 },
  signatureLine: {
    borderBottom: "1pt solid #1a1a1a",
    height: 26,
    marginBottom: 4,
  },
  signatureLabel: { fontSize: 8, color: "#555555" },
  ackNote: { marginTop: 20, fontSize: 8, color: "#555555", lineHeight: 1.4 },
});

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function DisciplinaryPdf({ data }: { data: DisciplinaryPdfData }) {
  return (
    <Document
      title={`Disciplinary Action Report — ${data.employeeName}`}
      author={data.companyName ?? "OpsHub"}
    >
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.companyName}>{data.companyName ?? "OpsHub"}</Text>
        <Text style={styles.title}>Disciplinary Action Report</Text>

        <View style={styles.metaTable}>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Employee</Text>
            <Text style={styles.metaValue}>
              {data.employeeName}
              {data.employeeJobTitle ? ` — ${data.employeeJobTitle}` : ""}
              {data.employeeDepartment ? ` (${data.employeeDepartment})` : ""}
            </Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Action type</Text>
            <Text style={styles.metaValue}>{DISCIPLINARY_ACTION_LABELS[data.actionType]}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Date of incident</Text>
            <Text style={styles.metaValue}>{formatDate(data.incidentDate)}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Date of report</Text>
            <Text style={styles.metaValue}>{formatDate(data.reportDate)}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Issued by</Text>
            <Text style={styles.metaValue}>{data.issuedByName}</Text>
          </View>
          {data.witnesses && (
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Witnesses</Text>
              <Text style={styles.metaValue}>{data.witnesses}</Text>
            </View>
          )}
          {data.followUpDate && (
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Follow-up review</Text>
              <Text style={styles.metaValue}>{formatDate(data.followUpDate)}</Text>
            </View>
          )}
        </View>

        <Text style={styles.sectionHeading}>Description of incident</Text>
        <Text style={styles.body}>{data.description}</Text>

        {data.actionTaken && (
          <>
            <Text style={styles.sectionHeading}>Action taken</Text>
            <Text style={styles.body}>{data.actionTaken}</Text>
          </>
        )}

        {data.improvementPlan && (
          <>
            <Text style={styles.sectionHeading}>Expected improvement</Text>
            <Text style={styles.body}>{data.improvementPlan}</Text>
          </>
        )}

        <View style={styles.signatureBlock}>
          <View style={styles.signature}>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureLabel}>
              Employee signature — {data.employeeName}
              {data.acknowledgedAt ? `  (acknowledged ${formatDate(data.acknowledgedAt)})` : ""}
            </Text>
          </View>
          <View style={styles.signature}>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureLabel}>Issued by — {data.issuedByName}</Text>
          </View>
        </View>

        <Text style={styles.ackNote}>
          The employee&apos;s signature confirms receipt and discussion of this report; it does not
          necessarily indicate agreement. A copy is retained in the personnel record.
        </Text>
      </Page>
    </Document>
  );
}

export async function renderDisciplinaryPdf(data: DisciplinaryPdfData): Promise<Buffer> {
  return renderToBuffer(<DisciplinaryPdf data={data} />);
}
