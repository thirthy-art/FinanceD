import {
  getDocument,
  Util,
  VerbosityLevel,
} from "pdfjs-dist/legacy/build/pdf.mjs";
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

export const PDF_LAYOUT_EXTRACTOR_VERSION = "pdfjs-5.4.296-layout-v1";

interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
}

function isTextItem(item: unknown): item is PdfTextItem {
  return typeof item === "object" && item !== null && "str" in item && "transform" in item;
}

function axisAlignedTextBox(viewportTransform: number[], item: PdfTextItem): NumericBox {
  const transform = Util.transform(viewportTransform, item.transform);
  const directionLength = Math.hypot(transform[0], transform[1]) || 1;
  const widthVector = {
    x: (transform[0] / directionLength) * item.width,
    y: (transform[1] / directionLength) * item.width,
  };
  const heightVector = { x: transform[2], y: transform[3] };
  const corners = [
    { x: transform[4], y: transform[5] },
    { x: transform[4] + widthVector.x, y: transform[5] + widthVector.y },
    { x: transform[4] + heightVector.x, y: transform[5] + heightVector.y },
    {
      x: transform[4] + widthVector.x + heightVector.x,
      y: transform[5] + widthVector.y + heightVector.y,
    },
  ];
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return {
    x: left,
    y: top,
    width: Math.max(...xs) - left,
    height: Math.max(...ys) - top,
  };
}

export async function extractPdfLayoutEvidence(bytes: Buffer | Uint8Array): Promise<DocumentEvidence> {
  const loadingTask = getDocument({
    data: new Uint8Array(bytes),
    verbosity: VerbosityLevel.ERRORS,
    useSystemFonts: false,
  });
  const pdf = await loadingTask.promise;
  try {
    const pages: DocumentEvidence["pages"] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const textContent = await page.getTextContent({ includeMarkedContent: false });
      const elements: DocumentEvidenceElement[] = [];
      let contentOrder = 0;
      for (const item of textContent.items) {
        if (!isTextItem(item) || !item.str.trim()) continue;
        const bbox = axisAlignedTextBox(viewport.transform, item);
        elements.push({
          id: evidenceElementId("pdf-text", pageNumber, contentOrder),
          page: pageNumber,
          text: item.str,
          confidence: null,
          bbox: serializeBox(bbox),
          normalizedBbox: normalizeBox(bbox, viewport.width, viewport.height),
          contentOrder,
          visualOrder: contentOrder,
          source: "pdf-text",
          extractorVersion: PDF_LAYOUT_EXTRACTOR_VERSION,
        });
        contentOrder += 1;
      }
      assignDeterministicVisualOrder(elements);
      pages.push({
        page: pageNumber,
        dimensions: {
          width: evidenceDecimal(viewport.width),
          height: evidenceDecimal(viewport.height),
          unit: "pdf-point",
        },
        elements,
      });
      page.cleanup();
    }
    return {
      formatVersion: DOCUMENT_EVIDENCE_VERSION,
      extractorVersion: PDF_LAYOUT_EXTRACTOR_VERSION,
      source: "pdf-text",
      pages,
    };
  } finally {
    await pdf.destroy();
  }
}
