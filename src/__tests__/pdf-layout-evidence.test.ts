import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { evidenceNumber } from "../lib/experimental/document-evidence";
import { clusterEvidenceTables } from "../lib/experimental/layout-table-clustering";
import { extractPdfLayoutEvidence } from "../lib/experimental/pdf-layout-evidence";

describe("born-digital PDF layout evidence", () => {
  it("extracts real page geometry and deterministic table references from a minimal PDF", async () => {
    const fixture = path.join(process.cwd(), "src/__tests__/fixtures/layout/minimal-layout-invoice.pdf");
    const evidence = await extractPdfLayoutEvidence(await readFile(fixture));

    expect(evidence.pages).toHaveLength(1);
    expect(evidence.pages[0].dimensions).toEqual({ width: "612", height: "792", unit: "pdf-point" });
    expect(evidence.pages[0].elements.map((element) => element.text)).toEqual(expect.arrayContaining([
      "LAYOUT PROBE INVOICE",
      "Description",
      "Consulting service",
      "200.00",
      "ROTATED NOTE",
    ]));
    for (const element of evidence.pages[0].elements) {
      expect(element.id).toMatch(/^pdf-text:p1-e\d{6}$/);
      expect(element.confidence).toBeNull();
      for (const value of Object.values(element.normalizedBbox)) {
        expect(evidenceNumber(value)).toBeGreaterThanOrEqual(0);
        expect(evidenceNumber(value)).toBeLessThanOrEqual(1);
      }
    }

    const rotated = evidence.pages[0].elements.find((element) => element.text === "ROTATED NOTE");
    expect(rotated).toBeDefined();
    expect(evidenceNumber(rotated!.bbox.height)).toBeGreaterThan(evidenceNumber(rotated!.bbox.width));

    const [table] = clusterEvidenceTables(evidence);
    expect(table).toMatchObject({ page: 1, columnCount: 3, rowCount: 3 });
    const knownIds = new Set(evidence.pages[0].elements.map((element) => element.id));
    for (const row of table.rows) {
      for (const cell of row.cells) {
        expect(cell.evidenceElementIds.every((id) => knownIds.has(id))).toBe(true);
      }
    }
  });
});
