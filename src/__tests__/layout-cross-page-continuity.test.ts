import { describe, expect, it } from "vitest";
import {
  DOCUMENT_EVIDENCE_VERSION,
  evidenceElementId,
  normalizeBox,
  serializeBox,
  type DocumentEvidence,
  type DocumentEvidenceElement,
} from "../lib/experimental/document-evidence";
import { clusterEvidenceTables } from "../lib/experimental/layout-table-clustering";
import {
  classifyEvidenceTables,
  type ClassifiedEvidenceTableCandidate,
} from "../lib/experimental/layout-block-classification";
import { linkCrossPageLineItemTables } from "../lib/experimental/layout-cross-page-continuity";

type CellSpec = { x: number; y: number; text: string };

function makeEvidence(
  pages: Array<{ page: number; rows: CellSpec[][] }>,
): DocumentEvidence {
  return {
    formatVersion: DOCUMENT_EVIDENCE_VERSION,
    extractorVersion: "test-v1",
    source: "pdf-text",
    pages: pages.map(({ page, rows }) => {
      const elements: DocumentEvidenceElement[] = [];
      rows.flat().forEach((input, contentOrder) => {
        const bbox = { x: input.x, y: input.y, width: 30, height: 10 };
        elements.push({
          id: evidenceElementId("pdf-text", page, contentOrder),
          page,
          text: input.text,
          confidence: null,
          bbox: serializeBox(bbox),
          normalizedBbox: normalizeBox(bbox, 600, 800),
          contentOrder,
          visualOrder: contentOrder,
          source: "pdf-text",
          extractorVersion: "test-v1",
        });
      });
      return {
        page,
        dimensions: { width: "600", height: "800", unit: "pdf-point" as const },
        elements,
      };
    }),
  };
}

function cell(x: number, y: number, text: string): CellSpec {
  return { x, y, text };
}

/** Standard 3-column line-item block starting at the given y. */
function lineItemRows(
  startY: number,
  dataRows: Array<[string, string, string]>,
): CellSpec[][] {
  return [
    [cell(20, startY, "Description"), cell(250, startY, "Qty"), cell(400, startY, "Amount")],
    ...dataRows.map((row, index) => [
      cell(20, startY + 20 * (index + 1), row[0]),
      cell(250, startY + 20 * (index + 1), row[1]),
      cell(400, startY + 20 * (index + 1), row[2]),
    ]),
  ];
}

function pipeline(evidence: DocumentEvidence) {
  const tables = classifyEvidenceTables(clusterEvidenceTables(evidence), evidence);
  const logicalTables = linkCrossPageLineItemTables(tables, evidence);
  return { tables, logicalTables };
}

describe("cross-page line-item continuity", () => {
  it("links two compatible consecutive line-item candidates into one logical table", () => {
    const evidence = makeEvidence([
      {
        page: 1,
        rows: lineItemRows(100, [
          ["Consulting", "2", "200.00"],
          ["Support", "1", "50.00"],
        ]),
      },
      {
        page: 2,
        rows: lineItemRows(100, [
          ["Hosting", "1", "80.00"],
          ["Backup", "1", "30.00"],
        ]),
      },
    ]);
    const { tables, logicalTables } = pipeline(evidence);
    expect(tables.map((table) => table.classification.role)).toEqual([
      "line_items",
      "line_items",
    ]);

    expect(logicalTables).toHaveLength(1);
    const logical = logicalTables[0];
    expect(logical.id).toBe("logical-001");
    expect(logical.pages).toEqual([1, 2]);
    expect(logical.candidateIds).toEqual(tables.map((table) => table.id));
    expect(logical.links).toHaveLength(1);
    expect(logical.links[0].fromCandidateId).toBe(tables[0].id);
    expect(logical.links[0].toCandidateId).toBe(tables[1].id);
    expect(logical.links[0].fromPage).toBe(1);
    expect(logical.links[0].toPage).toBe(2);
  });

  it("marks a repeated header on page 2 and excludes it from the data row count", () => {
    const evidence = makeEvidence([
      {
        page: 1,
        rows: lineItemRows(100, [
          ["Consulting", "2", "200.00"],
          ["Support", "1", "50.00"],
        ]),
      },
      {
        page: 2,
        rows: lineItemRows(100, [
          ["Hosting", "1", "80.00"],
          ["Backup", "1", "30.00"],
        ]),
      },
    ]);
    const { logicalTables } = pipeline(evidence);
    const logical = logicalTables[0];

    expect(logical.rowCount).toBe(6);
    expect(logical.dataRowCount).toBe(4);
    expect(logical.repeatedHeaderRowCount).toBe(1);
    expect(logical.rows.map((row) => row.kind)).toEqual([
      "header",
      "data",
      "data",
      "repeated-header",
      "data",
      "data",
    ]);
    expect(logical.links[0].repeatedHeader).toBe(true);
  });

  it("preserves original row order, evidence IDs, and page provenance", () => {
    const evidence = makeEvidence([
      {
        page: 1,
        rows: lineItemRows(100, [
          ["Consulting", "2", "200.00"],
          ["Support", "1", "50.00"],
        ]),
      },
      {
        page: 2,
        rows: lineItemRows(100, [
          ["Hosting", "1", "80.00"],
          ["Backup", "1", "30.00"],
        ]),
      },
    ]);
    const { tables, logicalTables } = pipeline(evidence);
    const logical = logicalTables[0];

    expect(logical.rows.map((row) => [row.sourcePage, row.sourceRowIndex])).toEqual([
      [1, 0],
      [1, 1],
      [1, 2],
      [2, 0],
      [2, 1],
      [2, 2],
    ]);
    expect(logical.rows.map((row) => row.sourceCandidateId)).toEqual([
      tables[0].id,
      tables[0].id,
      tables[0].id,
      tables[1].id,
      tables[1].id,
      tables[1].id,
    ]);

    const knownIds = new Map<string, number>();
    for (const page of evidence.pages) {
      for (const element of page.elements) knownIds.set(element.id, element.page);
    }
    for (const row of logical.rows) {
      expect(row.evidenceElementIds.length).toBeGreaterThan(0);
      for (const id of row.evidenceElementIds) {
        expect(knownIds.has(id)).toBe(true);
        expect(knownIds.get(id)).toBe(row.sourcePage);
      }
    }

    const underlyingRowIds = (candidate: ClassifiedEvidenceTableCandidate) =>
      candidate.rows.map((row) => row.cells.flatMap((cell) => cell.evidenceElementIds));
    expect(logical.rows.slice(0, 3).map((row) => row.evidenceElementIds)).toEqual(
      underlyingRowIds(tables[0]),
    );
    expect(logical.rows.slice(3).map((row) => row.evidenceElementIds)).toEqual(
      underlyingRowIds(tables[1]),
    );
  });

  it("links a sparse column mismatch when geometry strongly matches", () => {
    const xs = [10, 55, 100, 145, 190, 235, 280, 325, 370, 415, 460, 505];
    const headers = [
      "Description", "Item", "Qty", "Unit", "Price", "Rate",
      "Amount", "Hours", "Service", "Product", "Code", "Total",
    ];
    const page1Rows: CellSpec[][] = [
      headers.map((text, index) => cell(xs[index], 100, text)),
      ["Consulting", "Svc", "2", "1", "100.00", "100.00", "200.00", "2", "3", "4", "A1", "200.00"]
        .map((text, index) => cell(xs[index], 120, text)),
      ["Support", "Svc", "1", "1", "50.00", "50.00", "50.00", "1", "2", "3", "A2", "50.00"]
        .map((text, index) => cell(xs[index], 140, text)),
    ];

    // Page 2 keeps the same geometry for ten of the twelve columns.
    const xs2 = [10, 55, 100, 190, 235, 280, 325, 370, 460, 505];
    const headers2 = [
      "Description", "Item", "Qty", "Price", "Rate", "Amount", "Hours", "Service", "Code", "Total",
    ];
    const page2Rows: CellSpec[][] = [
      headers2.map((text, index) => cell(xs2[index], 100, text)),
      ["Hosting", "Svc", "1", "80.00", "80.00", "80.00", "1", "2", "B1", "80.00"]
        .map((text, index) => cell(xs2[index], 120, text)),
      ["Backup", "Svc", "1", "30.00", "30.00", "30.00", "1", "1", "B2", "30.00"]
        .map((text, index) => cell(xs2[index], 140, text)),
    ];

    const evidence = makeEvidence([
      { page: 1, rows: page1Rows },
      { page: 2, rows: page2Rows },
    ]);
    const { tables, logicalTables } = pipeline(evidence);
    expect(tables.map((table) => table.columnCount)).toEqual([12, 10]);
    expect(tables.map((table) => table.classification.role)).toEqual([
      "line_items",
      "line_items",
    ]);

    expect(logicalTables).toHaveLength(1);
    const logical = logicalTables[0];
    expect(logical.columnCount).toBe(12);
    expect(logical.candidateIds).toEqual(tables.map((table) => table.id));
    expect(logical.links[0].matchedColumnAnchors).toBe(10);
    expect(logical.links[0].comparedColumnAnchors).toBe(10);
    expect(Object.keys(logical.columnAnchorGeometry)).toEqual(logical.candidateIds);
  });

  it("does not link unrelated line-item-looking tables on consecutive pages", () => {
    const evidence = makeEvidence([
      {
        page: 1,
        rows: lineItemRows(100, [
          ["Consulting", "2", "200.00"],
          ["Support", "1", "50.00"],
        ]),
      },
      {
        page: 2,
        rows: [
          [cell(100, 100, "Product"), cell(300, 100, "Hours"), cell(500, 100, "Rate")],
          [cell(100, 120, "Design"), cell(300, 120, "3"), cell(500, 120, "75.00")],
          [cell(100, 140, "Build"), cell(300, 140, "5"), cell(500, 140, "75.00")],
        ],
      },
    ]);
    const { tables, logicalTables } = pipeline(evidence);
    expect(tables.map((table) => table.classification.role)).toEqual([
      "line_items",
      "line_items",
    ]);

    expect(logicalTables).toHaveLength(2);
    for (const logical of logicalTables) {
      expect(logical.candidateIds).toHaveLength(1);
      expect(logical.links).toHaveLength(0);
    }
  });

  it("keeps non-line-item blocks out of logical tables", () => {
    const evidence = makeEvidence([
      {
        page: 1,
        rows: lineItemRows(100, [
          ["Consulting", "2", "200.00"],
          ["Support", "1", "50.00"],
        ]),
      },
      {
        page: 2,
        rows: [
          [cell(20, 100, "Subtotal"), cell(400, 100, "250.00")],
          [cell(20, 120, "VAT"), cell(400, 120, "50.00")],
          [cell(20, 140, "Total"), cell(400, 140, "300.00")],
        ],
      },
    ]);
    const { tables, logicalTables } = pipeline(evidence);
    expect(tables.map((table) => table.classification.role)).toEqual(["line_items", "totals"]);

    expect(logicalTables).toHaveLength(1);
    expect(logicalTables[0].candidateIds).toEqual([tables[0].id]);
    expect(logicalTables[0].pages).toEqual([1]);
  });

  it("does not link a continuation candidate that is not classified line_items", () => {
    const evidence = makeEvidence([
      {
        page: 1,
        rows: lineItemRows(100, [
          ["Consulting", "2", "200.00"],
          ["Support", "1", "50.00"],
        ]),
      },
      {
        page: 2,
        rows: [
          [cell(20, 100, "Hosting"), cell(250, 100, "1"), cell(400, 100, "80.00")],
          [cell(20, 120, "Backup"), cell(250, 120, "1"), cell(400, 120, "30.00")],
          [cell(20, 140, "Restore"), cell(250, 140, "2"), cell(400, 140, "10.00")],
        ],
      },
    ]);
    const { tables, logicalTables } = pipeline(evidence);
    expect(tables.map((table) => table.classification.role)).toEqual(["line_items", "unknown"]);

    expect(logicalTables).toHaveLength(1);
    expect(logicalTables[0].candidateIds).toEqual([tables[0].id]);
  });

  it("chains a three-page continuation into one logical table", () => {
    const pageRows = (startY: number, rows: Array<[string, string, string]>) =>
      lineItemRows(startY, rows);
    const evidence = makeEvidence([
      { page: 1, rows: pageRows(100, [["Consulting", "2", "200.00"], ["Support", "1", "50.00"]]) },
      { page: 2, rows: pageRows(100, [["Hosting", "1", "80.00"], ["Backup", "1", "30.00"]]) },
      { page: 3, rows: pageRows(100, [["Restore", "2", "10.00"], ["Audit", "1", "90.00"]]) },
    ]);
    const { tables, logicalTables } = pipeline(evidence);

    expect(logicalTables).toHaveLength(1);
    const logical = logicalTables[0];
    expect(logical.pages).toEqual([1, 2, 3]);
    expect(logical.candidateIds).toEqual(tables.map((table) => table.id));
    expect(logical.links).toHaveLength(2);
    expect(logical.links.map((link) => [link.fromPage, link.toPage])).toEqual([
      [1, 2],
      [2, 3],
    ]);
    expect(logical.rowCount).toBe(9);
    expect(logical.dataRowCount).toBe(6);
    expect(logical.repeatedHeaderRowCount).toBe(2);
    expect(logical.rows.map((row) => row.sourcePage)).toEqual([1, 1, 1, 2, 2, 2, 3, 3, 3]);
  });
});
