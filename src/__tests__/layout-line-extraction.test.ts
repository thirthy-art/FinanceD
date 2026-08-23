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

  it("keeps explicit Item Code / Unit Price / Net Amount mappings working", () => {
    const { table, evidence } = makeLogicalTable(
      ["Item Code", "Unit Price", "Net Amount"],
      [["A-1", "25.00", "25.00"]],
    );
    const result = extractInvoiceLinesFromLogicalTable(table, evidence);

    expect(result.columnFields).toEqual({
      0: "lineNumber",
      1: "unitPrice",
      2: "netAmount",
    });
    expect(result.useful).toBe(true);
    expect(result.lines[0]).toMatchObject({
      lineNumber: "A-1",
      unitPrice: "25",
      netAmount: "25",
    });
  });

  it("never maps bare Item to lineNumber", () => {
    const { table, evidence } = makeLogicalTable(
      ["Item", "Qty", "Net Amount"],
      [["Widget", "2", "10.00"]],
    );
    const result = extractInvoiceLinesFromLogicalTable(table, evidence);

    expect(result.columnFields).toEqual({ 1: "quantity", 2: "netAmount" });
    expect(result.diagnostics.unmappedHeaderTexts).toEqual(["Item"]);
    expect(result.lines[0].lineNumber).toBeNull();
    expect(result.lines[0].descriptionOriginal).toBeNull();
  });

  it("never guesses bare Price as unitPrice, even beside a quantity column", () => {
    const { table, evidence } = makeLogicalTable(
      ["Description", "Qty", "Price"],
      [["Work", "3", "12.50"]],
    );
    const result = extractInvoiceLinesFromLogicalTable(table, evidence);

    expect(result.columnFields).toEqual({ 0: "descriptionOriginal", 1: "quantity" });
    expect(result.diagnostics.unmappedHeaderTexts).toEqual(["Price"]);
    expect(result.lines[0].unitPrice).toBeNull();
    expect(result.lines[0].netAmount).toBeNull();
  });

  it("never guesses bare Amount as netAmount outside the Qty x unit-price layout", () => {
    const { table, evidence } = makeLogicalTable(
      ["Description", "Price", "Amount"],
      [["Work", "12.50", "37.50"]],
    );
    const result = extractInvoiceLinesFromLogicalTable(table, evidence);

    expect(result.columnFields).toEqual({ 0: "descriptionOriginal" });
    expect(result.diagnostics.unmappedHeaderTexts).toEqual(["Price", "Amount"]);
    expect(result.lines[0].unitPrice).toBeNull();
    expect(result.lines[0].netAmount).toBeNull();
  });

  it("never guesses bare Total as grossAmount", () => {
    const withNet = makeLogicalTable(
      ["Description", "Net", "Total"],
      [["Work", "100.00", "123.00"]],
    );
    const netResult = extractInvoiceLinesFromLogicalTable(withNet.table, withNet.evidence);
    expect(netResult.columnFields).toEqual({ 0: "descriptionOriginal", 1: "netAmount" });
    expect(netResult.diagnostics.unmappedHeaderTexts).toEqual(["Total"]);
    expect(netResult.lines[0].grossAmount).toBeNull();

    const bare = makeLogicalTable(["Description", "Total"], [["Work", "123.00"]]);
    const bareResult = extractInvoiceLinesFromLogicalTable(bare.table, bare.evidence);
    expect(bareResult.columnFields).toEqual({ 0: "descriptionOriginal" });
    expect(bareResult.diagnostics.unmappedHeaderTexts).toEqual(["Total"]);
    expect(bareResult.lines[0].grossAmount).toBeNull();
  });

  it("rejects duplicate field claims instead of picking one", () => {
    const { table, evidence } = makeLogicalTable(
      ["Description", "Net", "Net Amount"],
      [["Work", "100.00", "100.00"]],
    );
    const result = extractInvoiceLinesFromLogicalTable(table, evidence);

    expect(result.columnFields).toEqual({ 0: "descriptionOriginal" });
    expect(result.diagnostics.conflictingFields).toEqual(["netAmount"]);
    expect(result.lines[0].netAmount).toBeNull();
    // Description-only lines fail the usefulness gate.
    expect(result.useful).toBe(false);
  });

  it("maps the known simple-invoice header Item | Quantity | Rate | Amount", () => {
    const { table, evidence } = makeLogicalTable(
      ["Item", "Quantity", "Rate", "Amount"],
      [
        ["Test1", "1", "13440.00", "13440.00"],
        ["Test2", "2", "100.00", "200.00"],
        ["Test3", "3", "25.00", "75.00"],
      ],
    );
    const result = extractInvoiceLinesFromLogicalTable(table, evidence);

    expect(result.useful).toBe(true);
    expect(result.columnFields).toEqual({
      0: "descriptionOriginal",
      1: "quantity",
      2: "unitPrice",
      3: "netAmount",
    });
    expect(result.lines).toHaveLength(3);
    expect(result.lines[0]).toMatchObject({
      descriptionOriginal: "Test1",
      quantity: "1",
      unitPrice: "13440",
      netAmount: "13440",
    });
    expect(result.lines[2]).toMatchObject({
      descriptionOriginal: "Test3",
      quantity: "3",
      unitPrice: "25",
      netAmount: "75",
    });
  });

  it("does not extend the simple-invoice pattern when a tax header is present", () => {
    const { table, evidence } = makeLogicalTable(
      ["Item", "Quantity", "Rate", "Amount", "Vat %"],
      [["Test1", "1", "100.00", "100.00", "23"]],
    );
    const result = extractInvoiceLinesFromLogicalTable(table, evidence);

    // Rate and bare Amount stay unmapped; Item stays unmapped.
    expect(result.columnFields).toEqual({ 1: "quantity", 4: "vatRate" });
    expect(result.diagnostics.unmappedHeaderTexts).toEqual(["Item", "Rate", "Amount"]);
    expect(result.lines[0].unitPrice).toBeNull();
    expect(result.lines[0].netAmount).toBeNull();
  });
});

// ── Candidate-local column mapping across pages ──────────────────────────────

describe("candidate-local cross-page column mapping", () => {
  /** One page's candidate: header (kind given) plus data rows. */
  function candidatePageRows(
    page: number,
    candidateId: string,
    headerKind: "header" | "repeated-header",
    headerTexts: string[],
    dataRowTexts: string[][],
    elements: DocumentEvidenceElement[],
    order: { value: number },
  ): LogicalTableRow[] {
    const makeRow = (
      texts: string[],
      rowIndex: number,
      kind: LogicalTableRow["kind"],
    ): LogicalTableRow => {
      const cells = texts.map((text, columnIndex) => {
        const element = makeElement(
          page,
          order.value,
          20 + columnIndex * 60,
          100 + rowIndex * 20,
          text,
        );
        order.value += 1;
        elements.push(element);
        return { columnIndex, evidenceElementIds: [element.id] };
      });
      return {
        sourceCandidateId: candidateId,
        sourcePage: page,
        sourceRowIndex: rowIndex,
        kind,
        cells,
        evidenceElementIds: cells.flatMap((cell) => cell.evidenceElementIds),
      };
    };
    return [
      makeRow(headerTexts, 0, headerKind),
      ...dataRowTexts.map((texts, index) => makeRow(texts, index + 1, "data")),
    ];
  }

  it("maps continuation rows through their own candidate header, not page 1's", () => {
    const elements: DocumentEvidenceElement[] = [];
    const order = { value: 0 };

    // Page 1: Carfix-style 12-column candidate.
    const p1Rows = candidatePageRows(
      1,
      "cand-p1",
      "header",
      ["Item Code", "Description", "Qty", "U.Price", "Price", "Disc. %", "Amount", "Vat %", "Extra A", "Extra B", "Extra C", "Extra D"],
      [["10", "Widget", "2", "5.00", "10.00", "0", "10.00", "23", "xa", "xb", "xc", "xd"]],
      elements,
      order,
    );
    // Page 2: continuation candidate with a 10-column layout — the Item Code
    // and Description cells merged into one Description cell at index 0, and
    // the Item Code cell repeated at the last position instead of index 0.
    const p2Rows = candidatePageRows(
      2,
      "cand-p2",
      "repeated-header",
      ["Description", "Qty", "U.Price", "Price", "Disc. %", "Amount", "Vat %", "Extra A", "Extra B", "Item Code"],
      [["11 Gasket", "4", "1.50", "6.00", "0", "6.00", "23", "ya", "yb", "11"]],
      elements,
      order,
    );

    const rows = [...p1Rows, ...p2Rows];
    const table: LogicalLineItemTable = {
      id: "logical-xp",
      role: "line_items",
      linkerVersion: "deterministic-cross-page-link-v1",
      pages: [1, 2],
      candidateIds: ["cand-p1", "cand-p2"],
      columnCount: 12,
      rowCount: rows.length,
      dataRowCount: 2,
      repeatedHeaderRowCount: 1,
      rows,
      columnAnchorGeometry: {},
      links: [],
    };
    const evidence: DocumentEvidence = {
      formatVersion: DOCUMENT_EVIDENCE_VERSION,
      extractorVersion: "test-v1",
      source: "pdf-text",
      pages: [
        { page: 1, dimensions: { width: "600", height: "800", unit: "pdf-point" }, elements: elements.filter((e) => e.page === 1) },
        { page: 2, dimensions: { width: "600", height: "800", unit: "pdf-point" }, elements: elements.filter((e) => e.page === 2) },
      ],
    };

    const result = extractInvoiceLinesFromLogicalTable(table, evidence);

    expect(result.useful).toBe(true);
    expect(result.lines).toHaveLength(2);

    const p1Line = result.lines[0];
    expect(p1Line.sourcePage).toBe(1);
    expect(p1Line.sourceCandidateId).toBe("cand-p1");
    expect(p1Line).toMatchObject({
      lineNumber: "10",
      descriptionOriginal: "Widget",
      quantity: "2",
      unitPrice: "5",
      netAmount: "10",
      vatRate: "23",
    });

    // Page-2 cells must resolve through the page-2 header positions: the p2
    // Item Code lives at column 9, not column 0 where p1 keeps it, and the p2
    // Amount/Vat % cells land in netAmount/vatRate rather than being shifted.
    const p2Line = result.lines[1];
    expect(p2Line.sourcePage).toBe(2);
    expect(p2Line.sourceCandidateId).toBe("cand-p2");
    expect(p2Line).toMatchObject({
      lineNumber: "11",
      descriptionOriginal: "11 Gasket",
      quantity: "4",
      unitPrice: "1.5",
      netAmount: "6",
      vatRate: "23",
    });

    // Price and Disc. % stay unsupported/unmapped on both candidates.
    expect(p1Line.vatAmount).toBeNull();
    expect(p1Line.grossAmount).toBeNull();
    expect(p2Line.vatAmount).toBeNull();
    expect(p2Line.grossAmount).toBeNull();
  });

  it("does not remap continuation rows when the candidate has no local header", () => {
    const elements: DocumentEvidenceElement[] = [];
    const order = { value: 0 };

    const p1Rows = candidatePageRows(
      1,
      "cand-p1",
      "header",
      ["Description", "Qty", "Net Amount"],
      [["Consulting", "2", "200.00"]],
      elements,
      order,
    );
    // Page-2 continuation candidate with no header of its own.
    const p2DataOnly = candidatePageRows(
      2,
      "cand-p2",
      "repeated-header",
      [],
      [["Shifted", "9", "999.00"]],
      elements,
      order,
    ).filter((row) => row.kind === "data");
    // Raw page-2 column indexes deliberately disagree with the page-1 layout
    // (Qty text placed at index 2, Net Amount text at index 1).
    const shiftedCells = p2DataOnly[0].cells.map((cell, index) => ({
      ...cell,
      columnIndex: [0, 2, 1][index],
    }));
    const shiftedRow = { ...p2DataOnly[0], cells: shiftedCells };

    const rows = [...p1Rows, shiftedRow];
    const table: LogicalLineItemTable = {
      id: "logical-noheader",
      role: "line_items",
      linkerVersion: "deterministic-cross-page-link-v1",
      pages: [1, 2],
      candidateIds: ["cand-p1", "cand-p2"],
      columnCount: 3,
      rowCount: rows.length,
      dataRowCount: 2,
      repeatedHeaderRowCount: 0,
      rows,
      columnAnchorGeometry: {},
      links: [],
    };
    const evidence: DocumentEvidence = {
      formatVersion: DOCUMENT_EVIDENCE_VERSION,
      extractorVersion: "test-v1",
      source: "pdf-text",
      pages: [
        { page: 1, dimensions: { width: "600", height: "800", unit: "pdf-point" }, elements: elements.filter((e) => e.page === 1) },
        { page: 2, dimensions: { width: "600", height: "800", unit: "pdf-point" }, elements: elements.filter((e) => e.page === 2) },
      ],
    };

    const result = extractInvoiceLinesFromLogicalTable(table, evidence);

    // Page-1 line extracts normally; the headerless continuation row is not
    // remapped through page 1's columns, so it yields no line.
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].descriptionOriginal).toBe("Consulting");
    expect(result.useful).toBe(true);
  });
});

// ── Usefulness gate ───────────────────────────────────────────────────────────

describe("usefulness gate", () => {
  it("fails for numeric-only rows with no identity/content column", () => {
    const { table, evidence } = makeLogicalTable(
      ["Qty", "Unit Price", "Net Amount"],
      [
        ["2", "100.00", "200.00"],
        ["1", "50.00", "50.00"],
      ],
    );
    const result = extractInvoiceLinesFromLogicalTable(table, evidence);

    // The rows are extracted, but they must not displace the AI fallback.
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0].netAmount).toBe("200");
    expect(result.useful).toBe(false);
  });

  it("passes with description plus numeric evidence", () => {
    const { table, evidence } = makeLogicalTable(
      ["Description", "Net Amount"],
      [["Work", "100.00"]],
    );
    const result = extractInvoiceLinesFromLogicalTable(table, evidence);
    expect(result.useful).toBe(true);
  });

  it("passes with a confidently mapped line number plus numeric evidence", () => {
    const { table, evidence } = makeLogicalTable(
      ["Item Code", "Net Amount"],
      [["A-1", "100.00"]],
    );
    const result = extractInvoiceLinesFromLogicalTable(table, evidence);
    expect(result.useful).toBe(true);
  });

  it("fails when identity exists but no numeric evidence does", () => {
    const { table, evidence } = makeLogicalTable(
      ["Item Code", "Description"],
      [["A-1", "Work"]],
    );
    const result = extractInvoiceLinesFromLogicalTable(table, evidence);
    expect(result.lines).toHaveLength(1);
    expect(result.useful).toBe(false);
  });
});

// ── Cell normalization ────────────────────────────────────────────────────────

describe("conservative cell normalization", () => {
  it("normalizes edge currency and percent marks without floating point", () => {
    const { table, evidence } = makeLogicalTable(
      ["Description", "Qty", "Net Amount", "Vat %"],
      [["Work", "2", "€1,234.56", "23%"]],
    );
    const result = extractInvoiceLinesFromLogicalTable(table, evidence);
    expect(result.lines[0].netAmount).toBe("1234.56");
    expect(result.lines[0].vatRate).toBe("23");
    expect(result.diagnostics.uncertainCellCount).toBe(0);
  });

  it("turns ambiguous locale/grouping forms into null instead of guessing", () => {
    const { table, evidence } = makeLogicalTable(
      ["Description", "Qty", "Net Amount"],
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
      ["Description", "Qty", "Net Amount"],
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
        rows: tableRows(100, ["Description", "Qty", "Net Amount"], [
          ["Consulting", "2", "200.00"],
          ["Support", "1", "50.00"],
        ]),
      },
      {
        page: 2,
        rows: tableRows(100, ["Description", "Qty", "Net Amount"], [
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
        rows: tableRows(100, ["Description", "Qty", "Net Amount"], [["Consulting", "2", "200.00"]]),
      },
      {
        page: 2,
        rows: tableRows(100, ["Description", "Qty", "Net Amount"], [["Hosting", "1", "80.00"]]),
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
          ...tableRows(100, ["Description", "Qty", "Net Amount"], [
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
