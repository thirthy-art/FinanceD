import { describe, expect, it } from "vitest";
import {
  assignDeterministicVisualOrder,
  evidenceElementId,
  normalizeBox,
  type DocumentEvidenceElement,
} from "../lib/experimental/document-evidence";

function element(contentOrder: number, x: string, y: string): DocumentEvidenceElement {
  return {
    id: evidenceElementId("pdf-text", 1, contentOrder),
    page: 1,
    text: `element-${contentOrder}`,
    confidence: null,
    bbox: { x, y, width: "10", height: "10" },
    normalizedBbox: { x: "0", y: "0", width: "0.1", height: "0.1" },
    contentOrder,
    visualOrder: contentOrder,
    source: "pdf-text",
    extractorVersion: "test-v1",
  };
}

describe("document evidence primitives", () => {
  it("creates deterministic page-scoped IDs", () => {
    expect(evidenceElementId("pdf-text", 2, 109)).toBe("pdf-text:p2-e000109");
    expect(evidenceElementId("ocr-word", 2, 109)).toBe("ocr-word:p2-e000109");
    expect(evidenceElementId("pdf-text", 2, 109)).toBe(evidenceElementId("pdf-text", 2, 109));
  });

  it("serializes normalized top-left boxes as decimal strings", () => {
    expect(normalizeBox({ x: 10, y: 20, width: 30, height: 40 }, 100, 200)).toEqual({
      x: "0.1",
      y: "0.1",
      width: "0.3",
      height: "0.2",
    });
  });

  it("preserves content order while assigning separate deterministic visual order", () => {
    const elements = [element(0, "10", "100"), element(1, "30", "20"), element(2, "5", "20")];
    assignDeterministicVisualOrder(elements);
    expect(elements.map((item) => item.contentOrder)).toEqual([0, 1, 2]);
    expect(elements.map((item) => item.visualOrder)).toEqual([2, 1, 0]);
  });
});
