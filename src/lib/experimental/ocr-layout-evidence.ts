import {
  DOCUMENT_EVIDENCE_VERSION,
  assignDeterministicVisualOrder,
  evidenceDecimal,
  evidenceElementId,
  normalizeBox,
  serializeBox,
  type DocumentEvidence,
  type DocumentEvidenceElement,
  type NumericBox,
} from "./document-evidence";

export const OCR_LAYOUT_EXTRACTOR_VERSION = "tesseract-js-7-layout-v1";

export interface OcrWordLike {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface OcrBlockLike {
  paragraphs: Array<{
    lines: Array<{ words: OcrWordLike[] }>;
  }>;
}

export function mapOcrBlocksToEvidencePage(
  blocks: OcrBlockLike[],
  options: { page: number; width: number; height: number },
): DocumentEvidence["pages"][number] {
  if (
    !Number.isInteger(options.page) || options.page < 1 ||
    !Number.isFinite(options.width) || options.width <= 0 ||
    !Number.isFinite(options.height) || options.height <= 0
  ) {
    throw new Error("OCR evidence requires a positive page number and finite positive dimensions.");
  }
  const elements: DocumentEvidenceElement[] = [];
  for (const block of blocks) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        for (const word of line.words) {
          if (!word.text.trim()) continue;
          const values = [
            word.confidence,
            word.bbox.x0,
            word.bbox.y0,
            word.bbox.x1,
            word.bbox.y1,
          ];
          if (
            values.some((value) => !Number.isFinite(value)) ||
            word.confidence < 0 || word.confidence > 100 ||
            word.bbox.x0 < 0 || word.bbox.y0 < 0 ||
            word.bbox.x1 < word.bbox.x0 || word.bbox.y1 < word.bbox.y0 ||
            word.bbox.x1 > options.width || word.bbox.y1 > options.height
          ) {
            throw new Error("OCR evidence contains invalid confidence or bounding-box data.");
          }
          const contentOrder = elements.length;
          const bbox: NumericBox = {
            x: word.bbox.x0,
            y: word.bbox.y0,
            width: Math.max(0, word.bbox.x1 - word.bbox.x0),
            height: Math.max(0, word.bbox.y1 - word.bbox.y0),
          };
          elements.push({
            id: evidenceElementId("ocr-word", options.page, contentOrder),
            page: options.page,
            text: word.text,
            confidence: evidenceDecimal(word.confidence),
            bbox: serializeBox(bbox),
            normalizedBbox: normalizeBox(bbox, options.width, options.height),
            contentOrder,
            visualOrder: contentOrder,
            source: "ocr-word",
            extractorVersion: OCR_LAYOUT_EXTRACTOR_VERSION,
          });
        }
      }
    }
  }
  assignDeterministicVisualOrder(elements);
  return {
    page: options.page,
    dimensions: {
      width: evidenceDecimal(options.width),
      height: evidenceDecimal(options.height),
      unit: "pixel",
    },
    elements,
  };
}

export async function extractImageOcrLayoutEvidence(
  bytes: Buffer | Uint8Array,
  options: { width: number; height: number; language?: string; page?: number },
): Promise<DocumentEvidence> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker(options.language ?? "eng", undefined, { cacheMethod: "none" });
  try {
    const { data } = await worker.recognize(Buffer.from(bytes), {}, { text: true, blocks: true });
    const page = mapOcrBlocksToEvidencePage((data.blocks ?? []) as OcrBlockLike[], {
      page: options.page ?? 1,
      width: options.width,
      height: options.height,
    });
    return {
      formatVersion: DOCUMENT_EVIDENCE_VERSION,
      extractorVersion: OCR_LAYOUT_EXTRACTOR_VERSION,
      source: "ocr-word",
      pages: [page],
    };
  } finally {
    await worker.terminate();
  }
}
