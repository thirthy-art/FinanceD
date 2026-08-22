import {
  evidenceNumber,
  numericBox,
  type DocumentEvidence,
  type DocumentEvidenceElement,
  type DocumentEvidencePage,
} from "./document-evidence";

export const TABLE_CLUSTER_EXTRACTOR_VERSION = "deterministic-column-cluster-v1";

export interface EvidenceTableCellCandidate {
  columnIndex: number;
  evidenceElementIds: string[];
}

export interface EvidenceTableRowCandidate {
  rowIndex: number;
  cells: EvidenceTableCellCandidate[];
}

export interface EvidenceTableCandidate {
  id: string;
  page: number;
  extractorVersion: typeof TABLE_CLUSTER_EXTRACTOR_VERSION;
  columnCount: number;
  rowCount: number;
  rows: EvidenceTableRowCandidate[];
  /** Sparse visual lines are reported, never guessed into an adjacent row. */
  excludedSparseLineElementIds: string[][];
}

interface VisualLine {
  elements: DocumentEvidenceElement[];
  top: number;
  bottom: number;
  center: number;
}

interface ColumnAnchor {
  x: number;
  samples: number;
  lineIndexes: Set<number>;
}

function groupVisualLines(page: DocumentEvidencePage): VisualLine[] {
  const lines: VisualLine[] = [];
  const ordered = [...page.elements].sort((left, right) => left.visualOrder - right.visualOrder);
  for (const element of ordered) {
    const box = numericBox(element.bbox);
    const center = box.y + box.height / 2;
    const previous = lines.at(-1);
    const tolerance = previous ? Math.max(1, Math.min(previous.bottom - previous.top, box.height) * 0.45) : 0;
    if (previous && Math.abs(previous.center - center) <= tolerance) {
      previous.elements.push(element);
      previous.top = Math.min(previous.top, box.y);
      previous.bottom = Math.max(previous.bottom, box.y + box.height);
      previous.center = (previous.top + previous.bottom) / 2;
    } else {
      lines.push({ elements: [element], top: box.y, bottom: box.y + box.height, center });
    }
  }
  for (const line of lines) {
    line.elements.sort((left, right) => numericBox(left.bbox).x - numericBox(right.bbox).x);
  }
  return lines;
}

function recurringColumnAnchors(lines: VisualLine[], tolerance: number): ColumnAnchor[] {
  const anchors: ColumnAnchor[] = [];
  lines.forEach((line, lineIndex) => {
    for (const element of line.elements) {
      const x = numericBox(element.bbox).x;
      const existing = anchors.find((anchor) => Math.abs(anchor.x - x) <= tolerance);
      if (existing) {
        existing.x = (existing.x * existing.samples + x) / (existing.samples + 1);
        existing.samples += 1;
        existing.lineIndexes.add(lineIndex);
      } else {
        anchors.push({ x, samples: 1, lineIndexes: new Set([lineIndex]) });
      }
    }
  });
  return anchors
    .filter((anchor) => anchor.lineIndexes.size >= 2)
    .sort((left, right) => left.x - right.x);
}

function splitVerticallyContiguousRegions(lines: VisualLine[]): VisualLine[][] {
  const regions: VisualLine[][] = [];
  for (const line of lines) {
    const current = regions.at(-1);
    const previous = current?.at(-1);
    if (!current || !previous) {
      regions.push([line]);
      continue;
    }
    const previousHeight = previous.bottom - previous.top;
    const currentHeight = line.bottom - line.top;
    const gap = line.top - previous.bottom;
    const maximumContiguousGap = Math.max(12, Math.max(previousHeight, currentHeight) * 3);
    if (gap > maximumContiguousGap) regions.push([line]);
    else current.push(line);
  }
  return regions;
}

function columnForX(x: number, anchors: ColumnAnchor[]): number {
  for (let index = 0; index < anchors.length - 1; index += 1) {
    const boundary = (anchors[index].x + anchors[index + 1].x) / 2;
    if (x < boundary) return index;
  }
  return anchors.length - 1;
}

export function clusterEvidenceTables(evidence: DocumentEvidence): EvidenceTableCandidate[] {
  const candidates: EvidenceTableCandidate[] = [];
  for (const page of evidence.pages) {
    const pageWidth = evidenceNumber(page.dimensions.width);
    const tolerance = Math.max(4, pageWidth * 0.015);
    const lines = groupVisualLines(page);
    for (const region of splitVerticallyContiguousRegions(lines)) {
      const anchors = recurringColumnAnchors(region, tolerance);
      if (anchors.length < 2) continue;

      const rows: EvidenceTableRowCandidate[] = [];
      const excludedSparseLineElementIds: string[][] = [];
      for (const line of region) {
        const byColumn = new Map<number, string[]>();
        for (const element of line.elements) {
          const columnIndex = columnForX(numericBox(element.bbox).x, anchors);
          const ids = byColumn.get(columnIndex) ?? [];
          ids.push(element.id);
          byColumn.set(columnIndex, ids);
        }
        if (byColumn.size < 2) {
          excludedSparseLineElementIds.push(line.elements.map((element) => element.id));
          continue;
        }
        rows.push({
          rowIndex: rows.length,
          cells: [...byColumn.entries()]
            .sort(([left], [right]) => left - right)
            .map(([columnIndex, evidenceElementIds]) => ({ columnIndex, evidenceElementIds })),
        });
      }
      if (rows.length < 2) continue;
      candidates.push({
        id: `p${page.page}-table-${String(candidates.length).padStart(3, "0")}`,
        page: page.page,
        extractorVersion: TABLE_CLUSTER_EXTRACTOR_VERSION,
        columnCount: anchors.length,
        rowCount: rows.length,
        rows,
        excludedSparseLineElementIds,
      });
    }
  }
  return candidates;
}
