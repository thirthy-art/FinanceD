/**
 * Experimental, versioned document evidence shared by native PDF text and OCR.
 * These coordinates are structural evidence only; they are never monetary data.
 */
export const DOCUMENT_EVIDENCE_VERSION = "1" as const;

export type EvidenceSource = "pdf-text" | "ocr-word";

export interface EvidenceBox {
  /** Top-left x coordinate in the page's source coordinate space. */
  x: string;
  /** Top-left y coordinate in the page's source coordinate space. */
  y: string;
  width: string;
  height: string;
}

export interface EvidencePageDimensions {
  width: string;
  height: string;
  unit: "pdf-point" | "pixel";
}

export interface DocumentEvidenceElement {
  id: string;
  page: number;
  text: string;
  /** OCR confidence as a decimal string; native PDF text has no confidence. */
  confidence: string | null;
  bbox: EvidenceBox;
  /** Top-left box normalized to the inclusive 0..1 page range. */
  normalizedBbox: EvidenceBox;
  /** Order exposed by the source extractor. */
  contentOrder: number;
  /** Deterministic top-to-bottom, then left-to-right order. */
  visualOrder: number;
  source: EvidenceSource;
  extractorVersion: string;
}

export interface DocumentEvidencePage {
  page: number;
  dimensions: EvidencePageDimensions;
  elements: DocumentEvidenceElement[];
}

export interface DocumentEvidence {
  formatVersion: typeof DOCUMENT_EVIDENCE_VERSION;
  extractorVersion: string;
  source: EvidenceSource;
  pages: DocumentEvidencePage[];
}

export interface NumericBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function evidenceElementId(
  source: EvidenceSource,
  page: number,
  contentOrder: number,
): string {
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(contentOrder) || contentOrder < 0) {
    throw new Error("Evidence IDs require a positive page and non-negative content order.");
  }
  return `${source}:p${page}-e${String(contentOrder).padStart(6, "0")}`;
}

export function evidenceDecimal(value: number): string {
  if (!Number.isFinite(value)) throw new Error("Evidence coordinates must be finite.");
  const rounded = value.toFixed(6).replace(/(?:\.0+|(?:(\.\d*?)0+))$/, "$1");
  return rounded === "-0" || rounded === "" ? "0" : rounded;
}

export function evidenceNumber(value: string): number {
  const parsed = +value;
  if (!Number.isFinite(parsed)) throw new Error("Invalid evidence decimal string.");
  return parsed;
}

export function serializeBox(box: NumericBox): EvidenceBox {
  return {
    x: evidenceDecimal(box.x),
    y: evidenceDecimal(box.y),
    width: evidenceDecimal(box.width),
    height: evidenceDecimal(box.height),
  };
}

export function normalizeBox(box: NumericBox, pageWidth: number, pageHeight: number): EvidenceBox {
  if (!(pageWidth > 0) || !(pageHeight > 0)) throw new Error("Evidence pages require positive dimensions.");
  const left = Math.max(0, Math.min(pageWidth, box.x));
  const top = Math.max(0, Math.min(pageHeight, box.y));
  const right = Math.max(left, Math.min(pageWidth, box.x + box.width));
  const bottom = Math.max(top, Math.min(pageHeight, box.y + box.height));
  return serializeBox({
    x: left / pageWidth,
    y: top / pageHeight,
    width: (right - left) / pageWidth,
    height: (bottom - top) / pageHeight,
  });
}

export function assignDeterministicVisualOrder(elements: DocumentEvidenceElement[]): void {
  const ordered = [...elements].sort((left, right) => {
    const leftBox = numericBox(left.bbox);
    const rightBox = numericBox(right.bbox);
    const leftCenter = leftBox.y + leftBox.height / 2;
    const rightCenter = rightBox.y + rightBox.height / 2;
    const lineTolerance = Math.max(1, Math.min(leftBox.height, rightBox.height) * 0.45);
    if (Math.abs(leftCenter - rightCenter) > lineTolerance) return leftCenter - rightCenter;
    if (leftBox.x !== rightBox.x) return leftBox.x - rightBox.x;
    return left.contentOrder - right.contentOrder;
  });
  ordered.forEach((element, visualOrder) => {
    element.visualOrder = visualOrder;
  });
}

export function numericBox(box: EvidenceBox): NumericBox {
  return {
    x: evidenceNumber(box.x),
    y: evidenceNumber(box.y),
    width: evidenceNumber(box.width),
    height: evidenceNumber(box.height),
  };
}
