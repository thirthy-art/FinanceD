import { describe, expect, it } from "vitest";
import type { DocumentEvidence } from "@/src/lib/experimental/document-evidence";
import {
  hasPdfMagicBytes,
  MAX_LAYOUT_PROBE_BYTES,
  validateLayoutProbeFile,
} from "@/app/dev/layout-probe/layout-probe-shared";
import {
  buildEvidenceIndex,
  evidenceBoxPosition,
  isLayoutProbeResult,
  pageAspectRatio,
  resolveElementText,
  safeCssDecimal,
} from "@/app/dev/layout-probe/layout-probe-view";

function element(id: string, text: string, page = 1) {
  return {
    id,
    page,
    text,
    confidence: null,
    bbox: { x: "10", y: "20", width: "30", height: "8" },
    normalizedBbox: { x: "0.1", y: "0.2", width: "0.3", height: "0.08" },
    contentOrder: 0,
    visualOrder: 0,
    source: "pdf-text" as const,
    extractorVersion: "test",
  };
}

function evidence(): DocumentEvidence {
  return {
    formatVersion: "1",
    extractorVersion: "test",
    source: "pdf-text",
    pages: [
      {
        page: 1,
        dimensions: { width: "612", height: "792", unit: "pdf-point" },
        elements: [element("pdf-text:p1-e000000", "Alpha"), element("pdf-text:p1-e000001", "Beta")],
      },
    ],
  };
}

describe("layout probe view model", () => {
  it("indexes evidence elements by ID and resolves cell text", () => {
    const index = buildEvidenceIndex(evidence());
    expect(index.get("pdf-text:p1-e000001")?.text).toBe("Beta");
    expect(resolveElementText(index, ["pdf-text:p1-e000000", "pdf-text:p1-e000001"])).toBe(
      "Alpha Beta",
    );
    expect(resolveElementText(index, ["pdf-text:p9-e999999"])).toBe("(missing)");
  });

  it("keeps decimal strings intact when building CSS positions", () => {
    expect(evidenceBoxPosition({ x: "0.1", y: "0.2", width: "0.3", height: "0.08" })).toEqual({
      left: "calc(0.1 * 100%)",
      top: "calc(0.2 * 100%)",
      width: "calc(0.3 * 100%)",
      height: "calc(0.08 * 100%)",
    });
  });

  it("refuses to embed non-decimal strings into CSS", () => {
    expect(safeCssDecimal("1px;position:fixed")).toBe("0");
    expect(safeCssDecimal("0.5")).toBe("0.5");
    expect(safeCssDecimal("1")).toBe("1");
    expect(evidenceBoxPosition({ x: "url(evil)", y: "0", width: "0.5", height: "0.5" }).left)
      .toBe("calc(0 * 100%)");
  });

  it("builds a page aspect ratio from the page dimensions", () => {
    expect(
      pageAspectRatio({ width: "612", height: "792", unit: "pdf-point" }),
    ).toBe("612 / 792");
  });

  it("recognizes only well-shaped probe results", () => {
    expect(isLayoutProbeResult({ evidence: { pages: [] }, tables: [] })).toBe(true);
    expect(isLayoutProbeResult(null)).toBe(false);
    expect(isLayoutProbeResult({ error: "boom" })).toBe(false);
    expect(isLayoutProbeResult({ evidence: { pages: [] }, tables: "nope" })).toBe(false);
  });

  it("accepts candidates carrying a deterministic classification", () => {
    const result = {
      evidence: { pages: [] },
      tables: [
        {
          id: "p1-table-000",
          classification: { role: "line_items", reason: "line-item header + numeric rows" },
        },
      ],
    };
    expect(isLayoutProbeResult(result)).toBe(true);
  });
});

describe("layout probe upload validation", () => {
  it("accepts a non-empty PDF within the byte budget", () => {
    expect(
      validateLayoutProbeFile({ name: "invoice.pdf", size: 1000, type: "application/pdf" }),
    ).toBeNull();
    expect(validateLayoutProbeFile({ name: "INVOICE.PDF", size: 1000, type: "" })).toBeNull();
  });

  it("rejects empty, oversized, and non-PDF files", () => {
    expect(validateLayoutProbeFile({ name: "a.pdf", size: 0, type: "application/pdf" }))
      .toMatch(/empty/);
    expect(
      validateLayoutProbeFile({
        name: "a.pdf",
        size: MAX_LAYOUT_PROBE_BYTES + 1,
        type: "application/pdf",
      }),
    ).toMatch(/25 MiB/);
    expect(validateLayoutProbeFile({ name: "a.txt", size: 10, type: "text/plain" }))
      .toMatch(/Only PDF files/);
  });

  it("checks PDF magic bytes", () => {
    expect(hasPdfMagicBytes(new TextEncoder().encode("%PDF-1.3\n"))).toBe(true);
    expect(hasPdfMagicBytes(new TextEncoder().encode("%PD"))).toBe(false);
    expect(hasPdfMagicBytes(new TextEncoder().encode("hello world"))).toBe(false);
  });
});
