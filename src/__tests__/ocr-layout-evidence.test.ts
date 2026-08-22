import { describe, expect, it } from "vitest";
import { mapOcrBlocksToEvidencePage } from "../lib/experimental/ocr-layout-evidence";

describe("OCR evidence mapping", () => {
  it("maps Tesseract word confidence and boxes into the common evidence format", () => {
    const page = mapOcrBlocksToEvidencePage([
      {
        paragraphs: [{
          lines: [{
            words: [
              { text: "Bottom", confidence: 87.5, bbox: { x0: 20, y0: 80, x1: 70, y1: 100 } },
              { text: "Top", confidence: 99, bbox: { x0: 10, y0: 10, x1: 40, y1: 30 } },
            ],
          }],
        }],
      },
    ], { page: 3, width: 100, height: 200 });

    expect(page.dimensions).toEqual({ width: "100", height: "200", unit: "pixel" });
    expect(page.elements[0]).toMatchObject({
      id: "ocr-word:p3-e000000",
      page: 3,
      text: "Bottom",
      confidence: "87.5",
      contentOrder: 0,
      visualOrder: 1,
      normalizedBbox: { x: "0.2", y: "0.4", width: "0.5", height: "0.1" },
    });
    expect(page.elements[1]).toMatchObject({ contentOrder: 1, visualOrder: 0 });
  });

  it("rejects invalid page dimensions, confidence, and bounding boxes", () => {
    expect(() => mapOcrBlocksToEvidencePage([], { page: 0, width: 100, height: 200 })).toThrow(/dimensions/i);
    expect(() => mapOcrBlocksToEvidencePage([{
      paragraphs: [{ lines: [{ words: [
        { text: "Bad", confidence: Number.NaN, bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } },
      ] }] }],
    }], { page: 1, width: 100, height: 200 })).toThrow(/confidence/i);
    expect(() => mapOcrBlocksToEvidencePage([{
      paragraphs: [{ lines: [{ words: [
        { text: "Outside", confidence: 90, bbox: { x0: 90, y0: 0, x1: 110, y1: 10 } },
      ] }] }],
    }], { page: 1, width: 100, height: 200 })).toThrow(/bounding-box/i);
  });
});
