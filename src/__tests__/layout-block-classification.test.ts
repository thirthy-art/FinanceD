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
  type TableBlockRole,
} from "../lib/experimental/layout-block-classification";

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

function roles(evidence: DocumentEvidence): TableBlockRole[] {
  return classifyEvidenceTables(clusterEvidenceTables(evidence), evidence).map(
    (candidate) => candidate.classification.role,
  );
}

describe("deterministic block classification", () => {
  it("classifies an obvious line-items candidate as line_items", () => {
    const evidence = makeEvidence([
      [{ x: 20, y: 20, text: "Description" }, { x: 250, y: 20, text: "Qty" }, { x: 400, y: 20, text: "Amount" }],
      [{ x: 20, y: 40, text: "Service" }, { x: 250, y: 40, text: "2" }, { x: 400, y: 40, text: "200.00" }],
      [{ x: 20, y: 60, text: "Support" }, { x: 250, y: 60, text: "1" }, { x: 400, y: 60, text: "50.00" }],
    ]);
    expect(roles(evidence)).toEqual(["line_items"]);
  });

  it("classifies an obvious totals candidate as totals", () => {
    const evidence = makeEvidence([
      [{ x: 20, y: 20, text: "Subtotal" }, { x: 400, y: 20, text: "200.00" }],
      [{ x: 20, y: 40, text: "VAT" }, { x: 400, y: 40, text: "40.00" }],
      [{ x: 20, y: 60, text: "Total" }, { x: 400, y: 60, text: "240.00" }],
    ]);
    expect(roles(evidence)).toEqual(["totals"]);
  });

  it("classifies a metadata/header-style candidate as invoice_metadata", () => {
    const evidence = makeEvidence([
      [{ x: 20, y: 20, text: "Invoice Number" }, { x: 250, y: 20, text: "INV-001" }],
      [{ x: 20, y: 40, text: "Invoice Date" }, { x: 250, y: 40, text: "2024-05-01" }],
      [{ x: 20, y: 60, text: "Bill To" }, { x: 250, y: 60, text: "Acme Ltd" }],
    ]);
    expect(roles(evidence)).toEqual(["invoice_metadata"]);
  });

  it("classifies an obvious footer/payment candidate as footer_or_payment", () => {
    const evidence = makeEvidence([
      [{ x: 20, y: 600, text: "Payment Method" }, { x: 250, y: 600, text: "Bank Transfer" }],
      [{ x: 20, y: 620, text: "IBAN" }, { x: 250, y: 620, text: "DE00 1234" }],
      [{ x: 20, y: 640, text: "SWIFT" }, { x: 250, y: 640, text: "ABCDDEFF" }],
    ]);
    expect(roles(evidence)).toEqual(["footer_or_payment"]);
  });

  it("supports weak footer terms only with bottom-quarter page position", () => {
    const bottom = makeEvidence([
      [{ x: 20, y: 700, text: "Thank" }, { x: 250, y: 700, text: "you" }],
      [{ x: 20, y: 720, text: "for" }, { x: 250, y: 720, text: "watching" }],
    ]);
    expect(roles(bottom)).toEqual(["footer_or_payment"]);

    const top = makeEvidence([
      [{ x: 20, y: 40, text: "Thank" }, { x: 250, y: 40, text: "you" }],
      [{ x: 20, y: 60, text: "for" }, { x: 250, y: 60, text: "watching" }],
    ]);
    expect(roles(top)).toEqual(["unknown"]);
  });

  it("leaves an ambiguous candidate as unknown", () => {
    const evidence = makeEvidence([
      [{ x: 20, y: 20, text: "A heading" }, { x: 250, y: 20, text: "A value" }],
      [{ x: 20, y: 40, text: "A row" }, { x: 250, y: 40, text: "A cell" }],
    ]);
    expect(roles(evidence)).toEqual(["unknown"]);
  });

  it("prefers line_items over totals when the header merely contains Total", () => {
    const evidence = makeEvidence([
      [{ x: 20, y: 20, text: "Description" }, { x: 250, y: 20, text: "Qty" }, { x: 400, y: 20, text: "Total" }],
      [{ x: 20, y: 40, text: "Service" }, { x: 250, y: 40, text: "2" }, { x: 400, y: 40, text: "200.00" }],
      [{ x: 20, y: 60, text: "Support" }, { x: 250, y: 60, text: "1" }, { x: 400, y: 60, text: "50.00" }],
    ]);
    expect(roles(evidence)).toEqual(["line_items"]);
  });

  it("keeps classification deterministic and free of copied invoice text", () => {
    const evidence = makeEvidence([
      [{ x: 20, y: 20, text: "Subtotal" }, { x: 400, y: 20, text: "200.00" }],
      [{ x: 20, y: 40, text: "Total" }, { x: 400, y: 40, text: "240.00" }],
    ]);
    const first = classifyEvidenceTables(clusterEvidenceTables(evidence), evidence);
    const second = classifyEvidenceTables(clusterEvidenceTables(evidence), evidence);
    expect(first).toEqual(second);
    expect(JSON.stringify(first[0].classification)).not.toContain("Subtotal");
    expect(first[0].classification).toEqual({
      role: "totals",
      reason: "totals labels with values",
    });
  });
});
