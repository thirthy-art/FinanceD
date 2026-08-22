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

function makeEvidence(rows: Array<Array<{ x: number; y: number; text: string }>>): DocumentEvidence {
  const elements: DocumentEvidenceElement[] = [];
  rows.flat().forEach((input, contentOrder) => {
    const bbox = { x: input.x, y: input.y, width: 30, height: 10 };
    elements.push({
      id: evidenceElementId("pdf-text", 1, contentOrder),
      page: 1,
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
    formatVersion: DOCUMENT_EVIDENCE_VERSION,
    extractorVersion: "test-v1",
    source: "pdf-text",
    pages: [{ page: 1, dimensions: { width: "600", height: "800", unit: "pdf-point" }, elements }],
  };
}

describe("deterministic table clustering", () => {
  it("emits rows and cells that reference evidence IDs, never copied values", () => {
    const evidence = makeEvidence([
      [{ x: 20, y: 20, text: "Description" }, { x: 250, y: 20, text: "Qty" }, { x: 400, y: 20, text: "Total" }],
      [{ x: 20, y: 40, text: "Service" }, { x: 250, y: 40, text: "2" }, { x: 400, y: 40, text: "200.00" }],
      [{ x: 20, y: 60, text: "Support" }, { x: 250, y: 60, text: "1" }, { x: 400, y: 60, text: "50.00" }],
    ]);
    const [candidate] = clusterEvidenceTables(evidence);
    expect(candidate).toMatchObject({ page: 1, columnCount: 3, rowCount: 3 });
    expect(candidate.rows[1].cells[0].evidenceElementIds).toEqual([evidence.pages[0].elements[3].id]);
    expect(JSON.stringify(candidate)).not.toContain("200.00");
  });

  it("reports a wrapped sparse line instead of guessing it into a neighboring row", () => {
    const evidence = makeEvidence([
      [{ x: 20, y: 20, text: "Description" }, { x: 250, y: 20, text: "Qty" }],
      [{ x: 20, y: 40, text: "Long service" }, { x: 250, y: 40, text: "2" }],
      [{ x: 20, y: 55, text: "continued detail" }],
      [{ x: 20, y: 75, text: "Support" }, { x: 250, y: 75, text: "1" }],
    ]);
    const [candidate] = clusterEvidenceTables(evidence);
    expect(candidate.rowCount).toBe(3);
    expect(candidate.excludedSparseLineElementIds).toContainEqual([evidence.pages[0].elements[4].id]);
  });

  it("does not turn unrelated single-column sparse lines into a table", () => {
    const evidence = makeEvidence([
      [{ x: 20, y: 20, text: "Heading" }],
      [{ x: 20, y: 40, text: "Address" }],
      [{ x: 20, y: 60, text: "Footer" }],
    ]);
    expect(clusterEvidenceTables(evidence)).toEqual([]);
  });

  it("does not merge widely separated aligned regions into one table", () => {
    const evidence = makeEvidence([
      [{ x: 20, y: 20, text: "A heading" }, { x: 250, y: 20, text: "A value" }],
      [{ x: 20, y: 40, text: "A row" }, { x: 250, y: 40, text: "A cell" }],
      [{ x: 20, y: 300, text: "B heading" }, { x: 250, y: 300, text: "B value" }],
      [{ x: 20, y: 320, text: "B row" }, { x: 250, y: 320, text: "B cell" }],
    ]);
    const candidates = clusterEvidenceTables(evidence);
    expect(candidates).toHaveLength(2);
    expect(candidates.map((candidate) => candidate.rowCount)).toEqual([2, 2]);
    expect(candidates[0].rows.flatMap((row) => row.cells.flatMap((cell) => cell.evidenceElementIds)))
      .not.toContain(evidence.pages[0].elements[4].id);
  });
});
