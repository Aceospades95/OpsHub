/**
 * Quote / template DOCX rendering via the `docx` package.
 *
 * DOCX is the "downloadable template" format the spec asks for so users
 * can edit the document outside OpsHub (Word, Google Docs, Pages all open
 * .docx). Layout intentionally mirrors the PDF — same headings, same
 * line-item table — so flipping between formats produces consistent
 * documents for the same quote.
 *
 * We use the `docx` package directly (returns a Buffer) rather than
 * routing through a streaming pipeline because quotes are small (<1MB
 * even for huge line-item lists) and a sync buffer keeps the route
 * handler simple.
 */

import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  BorderStyle,
} from "docx";
import { formatCurrency } from "./totals";

export interface DocxLineItem {
  name: string;
  description: string | null;
  groupLabel: string | null;
  quantity: number;
  unit: string | null;
  unitPrice: number;
  subtotal: number;
  isOptional: boolean;
  isRecurring: boolean;
  recurringInterval: "MONTHLY" | "QUARTERLY" | "ANNUALLY" | null;
}

export interface QuoteDocxData {
  /** Headline shown at the top of the document. For quotes this is the
   *  quote number; for templates it's "Template: {name}". */
  reference: string;
  title: string;
  introText: string | null;
  termsText: string | null;
  currency: string;
  taxRate: number | null;
  /** Optional metadata line under the title (client name, valid-until). */
  meta: string | null;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  total: number;
  lineItems: DocxLineItem[];
  /** Optional company branding line shown at the very top. */
  companyName: string | null;
}

const NO_BORDER = {
  top: { style: BorderStyle.NONE, size: 0, color: "ffffff" },
  bottom: { style: BorderStyle.NONE, size: 0, color: "ffffff" },
  left: { style: BorderStyle.NONE, size: 0, color: "ffffff" },
  right: { style: BorderStyle.NONE, size: 0, color: "ffffff" },
};

const HEADER_BORDER = {
  ...NO_BORDER,
  bottom: { style: BorderStyle.SINGLE, size: 6, color: "1a1a1a" },
};

const CELL_BORDER = {
  ...NO_BORDER,
  bottom: { style: BorderStyle.SINGLE, size: 4, color: "e5e5e5" },
};

function plain(text: string, opts: { bold?: boolean; size?: number; color?: string } = {}): TextRun {
  return new TextRun({
    text,
    bold: opts.bold,
    size: opts.size,
    color: opts.color,
  });
}

function tableHeader(label: string, alignment: (typeof AlignmentType)[keyof typeof AlignmentType] = AlignmentType.LEFT): TableCell {
  return new TableCell({
    borders: HEADER_BORDER,
    children: [
      new Paragraph({
        alignment,
        children: [plain(label, { bold: true, size: 18, color: "555555" })],
      }),
    ],
  });
}

function tableCell(
  text: string,
  alignment: (typeof AlignmentType)[keyof typeof AlignmentType] = AlignmentType.LEFT,
  bold = false
): TableCell {
  return new TableCell({
    borders: CELL_BORDER,
    children: [
      new Paragraph({
        alignment,
        children: [plain(text, { bold, size: 20 })],
      }),
    ],
  });
}

export async function renderQuoteDocx(data: QuoteDocxData): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [];

  if (data.companyName) {
    children.push(
      new Paragraph({
        children: [plain(data.companyName, { bold: true, size: 22 })],
      })
    );
  }
  children.push(
    new Paragraph({
      children: [plain(data.reference, { size: 18, color: "888888" })],
      spacing: { after: 120 },
    })
  );
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [plain(data.title, { bold: true, size: 36 })],
    })
  );
  if (data.meta) {
    children.push(
      new Paragraph({
        children: [plain(data.meta, { size: 20, color: "555555" })],
        spacing: { after: 240 },
      })
    );
  }

  if (data.introText) {
    for (const paragraph of data.introText.split(/\n{2,}/)) {
      children.push(
        new Paragraph({
          children: [plain(paragraph, { size: 22 })],
          spacing: { after: 160 },
        })
      );
    }
  }

  // Line items table
  const headerRow = new TableRow({
    children: [
      tableHeader("Item"),
      tableHeader("Qty", AlignmentType.RIGHT),
      tableHeader("Unit price", AlignmentType.RIGHT),
      tableHeader("Subtotal", AlignmentType.RIGHT),
    ],
  });

  const itemRows: TableRow[] = [];
  let lastGroup: string | null | undefined = undefined;
  for (const li of data.lineItems) {
    if (li.groupLabel !== lastGroup) {
      lastGroup = li.groupLabel;
      if (li.groupLabel) {
        itemRows.push(
          new TableRow({
            children: [
              new TableCell({
                columnSpan: 4,
                borders: NO_BORDER,
                children: [
                  new Paragraph({
                    spacing: { before: 200, after: 80 },
                    children: [
                      plain(li.groupLabel.toUpperCase(), {
                        bold: true,
                        size: 18,
                        color: "888888",
                      }),
                    ],
                  }),
                ],
              }),
            ],
          })
        );
      }
    }
    const metaParts = [
      li.isOptional ? "Optional" : null,
      li.isRecurring
        ? (li.recurringInterval ?? "RECURRING").toLowerCase()
        : null,
    ].filter(Boolean) as string[];

    const nameCell = new TableCell({
      borders: CELL_BORDER,
      children: [
        new Paragraph({
          children: [plain(li.name, { bold: true, size: 22 })],
        }),
        ...(li.description
          ? [
              new Paragraph({
                children: [plain(li.description, { size: 18, color: "555555" })],
              }),
            ]
          : []),
        ...(metaParts.length > 0
          ? [
              new Paragraph({
                children: [plain(metaParts.join(" · "), { size: 16, color: "888888" })],
              }),
            ]
          : []),
      ],
    });
    itemRows.push(
      new TableRow({
        children: [
          nameCell,
          tableCell(
            `${li.quantity}${li.unit ? ` ${li.unit}` : ""}`,
            AlignmentType.RIGHT
          ),
          tableCell(
            formatCurrency(li.unitPrice, data.currency),
            AlignmentType.RIGHT
          ),
          tableCell(
            formatCurrency(li.subtotal, data.currency),
            AlignmentType.RIGHT,
            true
          ),
        ],
      })
    );
  }

  children.push(
    new Table({
      rows: [headerRow, ...itemRows],
      width: { size: 100, type: WidthType.PERCENTAGE },
    })
  );

  // Totals
  const totalsRows: TableRow[] = [
    new TableRow({
      children: [
        new TableCell({
          borders: NO_BORDER,
          children: [new Paragraph({ children: [plain("Subtotal", { size: 20 })] })],
        }),
        new TableCell({
          borders: NO_BORDER,
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [plain(formatCurrency(data.subtotal, data.currency), { size: 20 })],
            }),
          ],
        }),
      ],
    }),
  ];
  if (data.discountAmount > 0) {
    totalsRows.push(
      new TableRow({
        children: [
          new TableCell({
            borders: NO_BORDER,
            children: [new Paragraph({ children: [plain("Discount", { size: 20 })] })],
          }),
          new TableCell({
            borders: NO_BORDER,
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  plain(`−${formatCurrency(data.discountAmount, data.currency)}`, {
                    size: 20,
                  }),
                ],
              }),
            ],
          }),
        ],
      })
    );
  }
  if (data.taxRate != null) {
    totalsRows.push(
      new TableRow({
        children: [
          new TableCell({
            borders: NO_BORDER,
            children: [
              new Paragraph({
                children: [plain(`Tax (${data.taxRate}%)`, { size: 20 })],
              }),
            ],
          }),
          new TableCell({
            borders: NO_BORDER,
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [plain(formatCurrency(data.taxAmount, data.currency), { size: 20 })],
              }),
            ],
          }),
        ],
      })
    );
  }
  totalsRows.push(
    new TableRow({
      children: [
        new TableCell({
          borders: HEADER_BORDER,
          children: [new Paragraph({ children: [plain("Total", { bold: true, size: 24 })] })],
        }),
        new TableCell({
          borders: HEADER_BORDER,
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [plain(formatCurrency(data.total, data.currency), { bold: true, size: 24 })],
            }),
          ],
        }),
      ],
    })
  );

  children.push(
    new Paragraph({ spacing: { before: 240 } }),
    new Table({
      rows: totalsRows,
      width: { size: 50, type: WidthType.PERCENTAGE },
      alignment: AlignmentType.RIGHT,
    })
  );

  if (data.termsText) {
    children.push(
      new Paragraph({ spacing: { before: 360 } }),
      new Paragraph({
        children: [
          plain("TERMS", { bold: true, size: 18, color: "888888" }),
        ],
      })
    );
    for (const para of data.termsText.split(/\n{2,}/)) {
      children.push(
        new Paragraph({
          children: [plain(para, { size: 18, color: "555555" })],
          spacing: { after: 120 },
        })
      );
    }
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });

  // `docx` returns a node Buffer when called via toBuffer().
  return Packer.toBuffer(doc);
}
