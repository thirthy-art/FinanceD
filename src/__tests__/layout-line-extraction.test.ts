import { describe, expect, it } from "vitest";
import { AiInvoiceLineSchema } from "../lib/ai-extraction";
import {
  DOCUMENT_EVIDENCE_VERSION,
  evidenceElementId,
  normalizeBox,
  serializeBox,
  type DocumentEvidence,
  type DocumentEvidenceElement,
} from "../lib/experimental/document-evidence";
import { clusterEvidenceTables } from "../lib/experimental/layout-table-clustering";
import { classifyEvidenceTables } from "../lib/experimental/layout-block-classification";
import {
  linkCrossPageLineItemTables,
  type LogicalLineItemTable,
  type LogicalTableRow,
} from "../lib/experimental/layout-cross-page-continuity";
import {
  LAYOUT_LINE_EXTRACTOR_VERSION,
  extractInvoiceLinesFromLogicalTable,
  mergeDeterministicWithAiLines,
  type DeterministicInvoiceLine,
} from "../lib/experimental/layout-line-extraction";

// ── Fixture helpers ───────────────────────────────────────────────────────────

function makeElement(
  page: number,
  contentOrder: number,
  x: number,
  y: number,
  text: string,
): DocumentEvidenceElement {
  const bbox = { x, y, width: 30, height: 10 };
  return {
    id: evidenceElementId("pdf-text", page, contentOrder),
    page,
    text,
    confidence: null,
    bbox: serializeBox(bbox),
    normalizedBbox: normalizeBox(bbox, 600, 800),
    contentOrder,
    visualOrder: contentOrder,
    source: "pdf-text",
    extractorVersion: "test-v1",
  };
}

/** Hand-built logical table with a header row and plain data rows on page 1. */
function makeLogicalTable(
  headerTexts: string[],
  dataRowTexts: string[][],
): { table: LogicalLineItemTable; evidence: DocumentEvidence } {
  const elements: DocumentEvidenceElement[] = [];
  let order = 0;
  const headerCells = headerTexts.map((text, columnIndex) => {
    const element = makeElement(1, order, 20 + columnIndex * 60, 100, text);
    order += 1;
    elements.push(element);
    return { columnIndex, evidenceElementIds: [element.id] };
  });
  const rows: LogicalTableRow[] = [
    {
      sourceCandidateId: "cand-1",
      sourcePage: 1,
      sourceRowIndex: 0,
      kind: "header",
      cells: headerCells,
      evidenceElementIds: headerCells.flatMap((cell) => cell.evidenceElementIds),
    },
  ];
  dataRowTexts.forEach((rowTexts, rowIndex) => {
    const cells = rowTexts.map((text, columnIndex) => {
      const element = makeElement(1, order, 20 + columnIndex * 60, 120 + rowIndex * 20, text);
      order += 1;
      elements.push(element);
      return { columnIndex, evidenceElementIds: [element.id] };
    });
    rows.push({
      sourceCandidateId: "cand-1",
      sourcePage: 1,
      sourceRowIndex: rowIndex + 1,
      kind: "data",
      cells,
      evidenceElementIds: cells.flatMap((cell) => cell.evidenceElementIds),
    });
  });

  const evidence: DocumentEvidence = {
    formatVersion: DOCUMENT_EVIDENCE_VERSION,
    extractorVersion: "test-v1",
    source: "pdf-text",
    pages: [
      {
        page: 1,
        dimensions: { width: "600", height: "800", unit: "pdf-point" },
        elements,
      },
    ],
  };

  const table: LogicalLineItemTable = {
    id: "logical-001",
    role: "line_items",
    linkerVersion: "deterministic-cross-page-link-v1",
    pages: [1],
    candidateIds: ["cand-1"],
    columnCount: headerTexts.length,
    rowCount: rows.length,
    dataRowCount: dataRowTexts.length,
    repeatedHeaderRowCount: 0,
    rows,
    columnAnchorGeometry: {},
    links: [],
  };
  return { table, evidence };
}

type CellSpec = { x: number; y: number; text: string };

function cell(x: number, y: number, text: string): CellSpec {
  return { x, y, text };
}

function makePagedEvidence(pages: Array<{ page: number; rows: CellSpec[][] }>): DocumentEvidence {
  return {
    formatVersion: DOCUMENT_EVIDENCE_VERSION,
    extractorVersion: "test-v1",
    source: "pdf-text",
    pages: pages.map(({ page, rows }) => {
      const elements: DocumentEvidenceElement[] = [];
      rows.flat().forEach((input, contentOrder) => {
        elements.push(makeElement(page, contentOrder, input.x, input.y, input.text));
      });
      return {
        page,
        dimensions: { width: "600", height: "800", unit: "pdf-point" as const },
        elements,
      };
    }),
  };
}

function fullPipeline(evidence: DocumentEvidence) {
  const classified = classifyEvidenceTables(clusterEvidenceTables(evidence), evidence);
  return linkCrossPageLineItemTables(classified, evidence);
}

// ── Header mapping ────────────────────────────────────────────────────────────

describe("deterministic header mapping", () => {
  it("maps a simple invoice header set to FinanceD line fields", () => {
    const { table, evidence } = makeLogicalTable(
      ["Description", "Qty", "Unit Price", "Amount"],
      [
        ["Consulting", "2", "100.00", "200.00"],
        ["Support", "1", "50.00", "50.00"],
      ],
    );
    const result = extractInvoiceLinesFromLogicalTable(table, evidence);

    expect(result.extractorVersion).toBe(LAYOUT_LINE_EXTRACTOR_VERSION);
    expect(result.useful).toBe(true);
    expect(result.columnFields).toEqual({
      0: "descriptionOriginal",
      1: "quantity",
      2: "unitPrice",
      3: "netAmount",
    });
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]).toMatchObject({
      descriptionOriginal: "Consulting",
      quantity: "2",
      unitPrice: "100",
      netAmount: "200",
      vatRate: null,
      grossAmount: null,
    });
    expect(result.lines[1]).toMatchObject({
      descriptionOriginal: "Support",
      quantity: "1",
      unitPrice: "50",
      netAmount: "50",
    });
  });

  it("maps the Carfix header set without confusing Price, Disc. %, or Vat %", () => {
    const { table, evidence } = makeLogicalTable(
      ["Item Code", "Description", "Qty", "U.Price", "Price", "Disc. %", "Amount", "Vat %"],
      [
        ["10", "Widget", "2", "5.00", "10.00", "0", "10.00", "23"],
        ["11", "Gasket", "4", "1.50", "6.00", "0", "6.00", "23"],
      ],
    );
    const result = extractInvoiceLinesFromLogicalTable(table, evidence);

    expect(result.useful).toBe(true);
    expect(result.columnFields).toEqual({
      0: "lineNumber",
      1: "descriptionOriginal",
      2: "quantity",
      3: "unitPrice",
      6: "netAmount",
      7: "vatRate",
    });
    expect(result.diagnostics.unsupportedHeaderTexts).toEqual(["Disc. %"]);
    expect(result.diagnostics.unmappedHeaderTexts).toEqual(["Price"]);
    expect(result.diagnostics.conflictingFields).toEqual([]);

    const line = result.lines[0];
    expect(line.lineNumber).toBe("10");
    expect(line.descriptionOriginal).toBe("Widget");
    expect(line.quantity).toBe("2");
    expect(line.unitPrice).toBe("5");
    expect(line.netAmount).toBe("10");
    expect(line.vatRate).toBe("23");
    // Price and Disc. % columns must not leak into any FinanceD field.
    expect(line.vatAmount).toBeNull();
    expect(line.grossAmount).toBeNull();
    expect(line.unit).toBeNull();
  });

  it("resolves bare Price to unitPrice only when a quantity column makes it safe", () => {
    const safe = makeLogicalTable(
      ["Description", "Qty", "Price"],
      [["Work", "3", "12.50"]],
    );
    const safeResult = extractInvoiceLinesFromLogicalTable(safe.table, safe.evidence);
    expect(safeResult.columnFields).toEqual({
      0: "descriptionOriginal",
      1: "quantity",
      2: "unitPrice",
    });
    expect(safeResult.lines[0].unitPrice).toBe("12.5");

    const ambiguous = makeLogicalTable(
      ["Description", "Price", "Amount"],
      [["Work", "12.50", "37.50"]],
    );
    const ambiguousResult = extractInvoiceLinesFromLogicalTable(
      ambiguous.table,
      ambiguous.evidence,
    );
    expect(ambiguousResult.columnFields).toEqual({
      0: "descriptionOriginal",
      2: "netAmount",
    });
    expect(ambiguousResult.diagnostics.unmappedHeaderTexts).toEqual(["Price"]);
    expect(ambiguousResult.lines[0].unitPrice).toBeNull();
  });

  it("resolves bare Total to grossAmount only when a net column makes it safe", () => {
    const safe = makeLogicalTable(
      ["Description", "Net", "Total"],
      [["Work", "100.00", "123.00"]],
    );
    const safeResult = extractInvoiceLinesFromLogicalTable(safe.table, safe.evidence);
    expect(safeResult.columnFields[1]).toBe("netAmount");
    expect(safeResult.columnFields[2]).toBe("grossAmount");
    expect(safeResult.lines[0].grossAmount).toBe("123");

    const ambiguous = makeLogicalTable(["Description", "Total"], [["Work", "123.00"]]);
    const ambiguousResult = extractInvoiceLinesFromLogicalTable(
      ambiguous.table,
      ambiguous.evidence,
    );
    expect(ambiguousResult.columnFields).toEqual({ 0: "descriptionOriginal" });
    expect(ambiguousResult.diagnostics.unmappedHeaderTexts).toEqual(["Total"]);
    expect(ambiguousResult.lines[0].grossAmount).toBeNull();
  });

  it("rejects duplicate field claims instead of picking one", () => {
    const { table, evidence } = makeLogicalTable(
      ["Description", "Amount", "Net Amount"],
      [["Work", "100.00", "100.00"]],
    );
    const result = extractInvoiceLinesFromLogicalTable(table, evidence);

    expect(result.columnFields).toEqual({ 0: "descriptionOriginal" });
    expect(result.diagnostics.conflictingFields).toEqual(["netAmount"]);
    expect(result.lines[0].netAmount).toBeNull();
    // One mapped field and no numeric column is below the usefulness gate.
    expect(result.useful).toBe(false);
  });
});

// ── Cell normalization ────────────────────────────────────────────────────────

describe("conservative cell normalization", () => {
  it("normalizes edge currency and percent marks without floating point", () => {
    const { table, evidence } = makeLogicalTable(
      ["Description", "Qty", "Amount", "Vat %"],
      [["Work", "2", "€1,234.56", "23%"]],
    );
    const result = extractInvoiceLinesFromLogicalTable(table, evidence);
    expect(result.lines[0].netAmount).toBe("1234.56");
    expect(result.lines[0].vatRate).toBe("23");
    expect(result.diagnostics.uncertainCellCount).toBe(0);
  });

  it("turns ambiguous locale/grouping forms into null instead of guessing", () => {
    const { table, evidence } = makeLogicalTable(
      ["Description", "Qty", "Amount"],
      [["Work", "1,234", "10.00"]],
    );
    const result = extractInvoiceLinesFromLogicalTable(table, evidence);
    expect(result.lines[0].quantity).toBeNull();
    expect(result.lines[0].netAmount).toBe("10");
    expect(result.diagnostics.uncertainCellCount).toBe(1);
  });

  it("drops structure-only rows with no resolvable field values", () => {
    const { table, evidence } = makeLogicalTable(
      ["Foo", "Bar"],
      [["alpha", "beta"]],
    );
    const result = extractInvoiceLinesFromLogicalTable(table, evidence);
    expect(result.lines).toEqual([]);
    expect(result.useful).toBe(false);
    expect(result.diagnostics.unmappedHeaderTexts).toEqual(["Foo", "Bar"]);
  });
});

// ── Provenance and reproducibility ────────────────────────────────────────────

describe("provenance and reproducibility", () => {
  it("preserves page, row, and per-field evidence provenance deterministically", () => {
    const { table, evidence } = makeLogicalTable(
      ["Description", "Qty", "Amount"],
      [["Consulting", "2", "200.00"]],
    );
    const first = extractInvoiceLinesFromLogicalTable(table, evidence);
    const second = extractInvoiceLinesFromLogicalTable(table, evidence);
    expect(second).toEqual(first);

    const line = first.lines[0];
    expect(line.sourcePage).toBe(1);
    expect(line.sourceCandidateId).toBe("cand-1");
    expect(line.sourceRowIndex).toBe(1);
    expect(line.rowEvidenceElementIds).toEqual([
      "pdf-text:p1-e000003",
      "pdf-text:p1-e000004",
      "pdf-text:p1-e000005",
    ]);
    expect(line.fieldEvidenceElementIds.descriptionOriginal).toEqual(["pdf-text:p1-e000003"]);
    expect(line.fieldEvidenceElementIds.quantity).toEqual(["pdf-text:p1-e000004"]);
    expect(line.fieldEvidenceElementIds.netAmount).toEqual(["pdf-text:p1-e000005"]);
  });
});

// ── Full pipeline: multi-page, repeated headers, metadata rows ───────────────

describe("logical table row kinds", () => {
  const columns = [20, 300, 480];

  function tableRows(
    startY: number,
    header: [string, string, string],
    data: Array<[string, string, string]>,
  ): CellSpec[][] {
    return [
      header.map((text, index) => cell(columns[index], startY, text)),
      ...data.map((row, rowIndex) =>
        row.map((text, index) => cell(columns[index], startY + 20 * (rowIndex + 1), text)),
      ),
    ];
  }

  it("extracts a multi-page table in document order with per-line sourcePage", () => {
    const evidence = makePagedEvidence([
      {
        page: 1,
        rows: tableRows(100, ["Description", "Qty", "Amount"], [
          ["Consulting", "2", "200.00"],
          ["Support", "1", "50.00"],
        ]),
      },
      {
        page: 2,
        rows: tableRows(100, ["Description", "Qty", "Amount"], [
          ["Hosting", "1", "80.00"],
          ["Backup", "1", "30.00"],
        ]),
      },
    ]);
    const logicalTables = fullPipeline(evidence);
    expect(logicalTables).toHaveLength(1);

    const result = extractInvoiceLinesFromLogicalTable(logicalTables[0], evidence);
    expect(result.useful).toBe(true);
    expect(result.lines.map((line) => line.descriptionOriginal)).toEqual([
      "Consulting",
      "Support",
      "Hosting",
      "Backup",
    ]);
    expect(result.lines.map((line) => line.sourcePage)).toEqual([1, 1, 2, 2]);
  });

  it("ignores repeated-header rows on continuation pages", () => {
    const evidence = makePagedEvidence([
      {
        page: 1,
        rows: tableRows(100, ["Description", "Qty", "Amount"], [["Consulting", "2", "200.00"]]),
      },
      {
        page: 2,
        rows: tableRows(100, ["Description", "Qty", "Amount"], [["Hosting", "1", "80.00"]]),
      },
    ]);
    const logicalTables = fullPipeline(evidence);
    expect(logicalTables).toHaveLength(1);
    expect(logicalTables[0].repeatedHeaderRowCount).toBe(1);

    const result = extractInvoiceLinesFromLogicalTable(logicalTables[0], evidence);
    expect(result.lines.map((line) => line.descriptionOriginal)).toEqual([
      "Consulting",
      "Hosting",
    ]);
    expect(result.lines.some((line) => line.descriptionOriginal === "Description")).toBe(false);
  });

  it("ignores metadata rows above the embedded header", () => {
    const evidence = makePagedEvidence([
      {
        page: 1,
        rows: [
          [cell(20, 60, "Invoice"), cell(300, 60, "INV-001")],
          ...tableRows(100, ["Description", "Qty", "Amount"], [
            ["Consulting", "2", "200.00"],
            ["Support", "1", "50.00"],
          ]),
        ],
      },
    ]);
    const logicalTables = fullPipeline(evidence);
    expect(logicalTables).toHaveLength(1);
    expect(logicalTables[0].rows[0].kind).toBe("metadata");

    const result = extractInvoiceLinesFromLogicalTable(logicalTables[0], evidence);
    expect(result.useful).toBe(true);
    expect(result.lines.map((line) => line.descriptionOriginal)).toEqual([
      "Consulting",
      "Support",
    ]);
  });
});

// ── AI merge semantics ────────────────────────────────────────────────────────

function detLine(overrides: Partial<DeterministicInvoiceLine> = {}): DeterministicInvoiceLine {
  return {
    lineNumber: null,
    descriptionOriginal: "Consulting",
    quantity: "2",
    unit: null,
    unitPrice: "100.00",
    netAmount: "200.00",
    vatRate: null,
    vatAmount: null,
    grossAmount: null,
    sourcePage: 1,
    sourceCandidateId: "cand-1",
    sourceRowIndex: 1,
    rowEvidenceElementIds: ["pdf-text:p1-e000003"],
    fieldEvidenceElementIds: { netAmount: ["pdf-text:p1-e000005"] },
    ...overrides,
  };
}

function aiLine(overrides: Record<string, unknown> = {}) {
  return {
    lineNumber: "1",
    descriptionOriginal: "AI description",
    description: "English description",
    quantity: "99",
    unit: "pcs",
    unitPrice: "0.01",
    netAmount: "999.99",
    vatRate: "5",
    vatAmount: "1.11",
    grossAmount: "1000.00",
    sourcePage: 2,
    ...overrides,
  };
}

describe("mergeDeterministicWithAiLines", () => {
  it("keeps confident deterministic values and lets AI fill only nulls when aligned", () => {
    const merged = mergeDeterministicWithAiLines(
      [detLine(), detLine({ descriptionOriginal: "Support", sourceRowIndex: 2 })],
      [aiLine(), aiLine({ lineNumber: "2" })],
    );

    expect(merged).toHaveLength(2);
    expect(merged[0].netAmount).toBe("200.00");
    expect(merged[0].unitPrice).toBe("100.00");
    expect(merged[0].quantity).toBe("2");
    expect(merged[0].descriptionOriginal).toBe("Consulting");
    // Null deterministic fields are filled from the aligned AI line.
    expect(merged[0].lineNumber).toBe("1");
    expect(merged[0].unit).toBe("pcs");
    expect(merged[0].vatRate).toBe("5");
    expect(merged[0].vatAmount).toBe("1.11");
    expect(merged[0].grossAmount).toBe("1000.00");
    expect(merged[0].description).toBe("English description");
    // Deterministic provenance wins over the AI's page guess.
    expect(merged[0].sourcePage).toBe(1);
    for (const line of merged) {
      expect(AiInvoiceLineSchema.safeParse(line).success).toBe(true);
    }
  });

  it("ignores AI line values entirely when row counts make alignment unsafe", () => {
    const merged = mergeDeterministicWithAiLines(
      [detLine(), detLine({ descriptionOriginal: "Support", sourceRowIndex: 2 })],
      [aiLine()],
    );

    expect(merged).toHaveLength(2);
    expect(merged[0].netAmount).toBe("200.00");
    expect(merged[0].lineNumber).toBeNull();
    expect(merged[0].unit).toBeNull();
    expect(merged[0].vatRate).toBeNull();
    expect(merged[0].grossAmount).toBeNull();
    expect(merged[0].description).toBeNull();
    expect(merged[1].descriptionOriginal).toBe("Support");
    for (const line of merged) {
      expect(AiInvoiceLineSchema.safeParse(line).success).toBe(true);
    }
  });
});
