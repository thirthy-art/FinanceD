/**
 * Deterministic, conservative cross-page linking for classified line_items
 * table candidates on consecutive PDF pages. Links only when page adjacency,
 * normalized column geometry, row structure, and header concepts all agree;
 * a missed continuation is preferred over merging unrelated tables.
 * All reported signals are stable tokens and rounded coordinates — never
 * copied invoice text.
 */
import {
  evidenceNumber,
  type DocumentEvidence,
  type DocumentEvidenceElement,
} from "./document-evidence";
import type { EvidenceTableCellCandidate } from "./layout-table-clustering";
import {
  LINE_ITEM_HEADER_CONCEPTS,
  isNumericLike,
  tokensOf,
  type ClassifiedEvidenceTableCandidate,
} from "./layout-block-classification";

export const CROSS_PAGE_LINKER_VERSION = "deterministic-cross-page-link-v1";

/** Normalized page-width fraction within which two column anchors align. */
const COLUMN_ANCHOR_TOLERANCE = 0.03;
/** Minimum matched anchors, and minimum share of the smaller profile. */
const MIN_MATCHED_ANCHORS = 2;
const MIN_MATCHED_ANCHOR_RATIO = 0.6;
/** Continuation rows may differ in height by at most this factor. */
const MAX_ROW_HEIGHT_RATIO = 2;

export type LogicalRowKind = "header" | "repeated-header" | "data";

export interface LogicalTableRow {
  sourceCandidateId: string;
  sourcePage: number;
  sourceRowIndex: number;
  kind: LogicalRowKind;
  cells: EvidenceTableCellCandidate[];
  /** All evidence element IDs of the row, in cell order. */
  evidenceElementIds: string[];
}

export interface CrossPageLink {
  fromCandidateId: string;
  toCandidateId: string;
  fromPage: number;
  toPage: number;
  matchedColumnAnchors: number;
  comparedColumnAnchors: number;
  headerConceptOverlap: string[];
  repeatedHeader: boolean;
  rowHeightRatio: string;
  /** Stable diagnostic tokens describing why the link was accepted. */
  reasons: string[];
}

export interface LogicalLineItemTable {
  id: string;
  role: "line_items";
  linkerVersion: typeof CROSS_PAGE_LINKER_VERSION;
  /** Pages contributing rows, in reading order. */
  pages: number[];
  /** Underlying candidate IDs, in reading order. */
  candidateIds: string[];
  /** Largest column count across the linked candidates. */
  columnCount: number;
  /** All rows, including header and repeated-header rows. */
  rowCount: number;
  dataRowCount: number;
  repeatedHeaderRowCount: number;
  rows: LogicalTableRow[];
  /** Normalized column anchor x positions per candidate (3dp, rounded). */
  columnAnchorGeometry: Record<string, string[]>;
  links: CrossPageLink[];
}

type EvidenceIndex = Map<string, DocumentEvidenceElement>;

function round3(value: number): string {
  return value.toFixed(3);
}

function candidateCellTexts(
  candidate: ClassifiedEvidenceTableCandidate,
  rowIndex: number,
  index: EvidenceIndex,
): string[] {
  const row = candidate.rows[rowIndex];
  if (!row) return [];
  return row.cells.map((cell) =>
    cell.evidenceElementIds.map((id) => index.get(id)?.text ?? "").join(" "),
  );
}

function headerConcepts(
  candidate: ClassifiedEvidenceTableCandidate,
  index: EvidenceIndex,
): Set<string> {
  const hits = new Set<string>();
  for (const token of candidateCellTexts(candidate, 0, index).flatMap(tokensOf)) {
    if (LINE_ITEM_HEADER_CONCEPTS.includes(token)) hits.add(token);
  }
  return hits;
}

/** Average normalized left-x of each column's elements, ordered by column. */
function columnAnchorProfile(
  candidate: ClassifiedEvidenceTableCandidate,
  index: EvidenceIndex,
): number[] {
  const byColumn = new Map<number, { sum: number; count: number }>();
  for (const row of candidate.rows) {
    for (const cell of row.cells) {
      for (const id of cell.evidenceElementIds) {
        const element = index.get(id);
        if (!element) continue;
        const entry = byColumn.get(cell.columnIndex) ?? { sum: 0, count: 0 };
        entry.sum += evidenceNumber(element.normalizedBbox.x);
        entry.count += 1;
        byColumn.set(cell.columnIndex, entry);
      }
    }
  }
  return [...byColumn.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, entry]) => entry.sum / entry.count);
}

/** Average per-row maximum element height, normalized to page height. */
function averageRowHeight(
  candidate: ClassifiedEvidenceTableCandidate,
  index: EvidenceIndex,
): number {
  let sum = 0;
  let counted = 0;
  for (const row of candidate.rows) {
    let rowHeight = 0;
    for (const cell of row.cells) {
      for (const id of cell.evidenceElementIds) {
        const element = index.get(id);
        if (element) rowHeight = Math.max(rowHeight, evidenceNumber(element.normalizedBbox.height));
      }
    }
    if (rowHeight > 0) {
      sum += rowHeight;
      counted += 1;
    }
  }
  return counted === 0 ? 0 : sum / counted;
}

/** Normalized top of the candidate, for deterministic reading order. */
function candidateTop(candidate: ClassifiedEvidenceTableCandidate, index: EvidenceIndex): number {
  let top = Number.POSITIVE_INFINITY;
  for (const row of candidate.rows) {
    for (const cell of row.cells) {
      for (const id of cell.evidenceElementIds) {
        const element = index.get(id);
        if (element) top = Math.min(top, evidenceNumber(element.normalizedBbox.y));
      }
    }
  }
  return top;
}

/** Greedy one-to-one matching of anchor x positions within tolerance. */
function matchColumnAnchors(anchorsA: number[], anchorsB: number[]): number {
  const used = new Set<number>();
  let matched = 0;
  for (const x of anchorsA) {
    let best = -1;
    let bestDistance = COLUMN_ANCHOR_TOLERANCE;
    anchorsB.forEach((y, anchorIndex) => {
      if (used.has(anchorIndex)) return;
      const distance = Math.abs(x - y);
      if (distance <= bestDistance) {
        best = anchorIndex;
        bestDistance = distance;
      }
    });
    if (best >= 0) {
      used.add(best);
      matched += 1;
    }
  }
  return matched;
}

/**
 * A repeated header repeats at least two header concepts of the first row, or
 * one concept while carrying no numeric cells (headers are not numeric-dense).
 */
function isRepeatedHeaderRow(
  cells: string[],
  overlap: number,
): boolean {
  if (overlap >= 2) return true;
  return overlap >= 1 && !cells.some(isNumericLike);
}

interface LinkAssessment {
  link: CrossPageLink;
  matchedRatio: number;
}

function assessLink(
  previous: ClassifiedEvidenceTableCandidate,
  next: ClassifiedEvidenceTableCandidate,
  previousAnchors: number[],
  nextAnchors: number[],
  previousHeight: number,
  nextHeight: number,
  index: EvidenceIndex,
): LinkAssessment | null {
  if (next.page !== previous.page + 1) return null;

  const compared = Math.min(previousAnchors.length, nextAnchors.length);
  const matched = matchColumnAnchors(previousAnchors, nextAnchors);
  const required = Math.max(MIN_MATCHED_ANCHORS, Math.ceil(MIN_MATCHED_ANCHOR_RATIO * compared));
  if (matched < required) return null;

  const heightRatio =
    previousHeight > 0 && nextHeight > 0
      ? Math.max(previousHeight, nextHeight) / Math.min(previousHeight, nextHeight)
      : Number.POSITIVE_INFINITY;
  if (heightRatio > MAX_ROW_HEIGHT_RATIO) return null;

  const nextHeader = headerConcepts(next, index);
  const overlap = [...headerConcepts(previous, index)].filter((concept) =>
    nextHeader.has(concept),
  );
  if (overlap.length < 1) return null;

  const repeatedHeader = isRepeatedHeaderRow(
    candidateCellTexts(next, 0, index),
    overlap.length,
  );

  return {
    matchedRatio: matched / Math.max(1, compared),
    link: {
      fromCandidateId: previous.id,
      toCandidateId: next.id,
      fromPage: previous.page,
      toPage: next.page,
      matchedColumnAnchors: matched,
      comparedColumnAnchors: compared,
      headerConceptOverlap: overlap.sort(),
      repeatedHeader,
      rowHeightRatio: round3(heightRatio),
      reasons: [
        "consecutive pages",
        `column anchors ${matched}/${compared} within ${COLUMN_ANCHOR_TOLERANCE}`,
        `header concept overlap ${overlap.length}`,
        repeatedHeader ? "repeated header on continuation" : "no repeated header",
        `row height ratio ${round3(heightRatio)}`,
      ],
    },
  };
}

interface OpenGroup {
  candidates: ClassifiedEvidenceTableCandidate[];
  links: CrossPageLink[];
  anchorsByCandidate: Record<string, number[]>;
  lastPage: number;
}

/**
 * Links classified line_items candidates into logical cross-page tables.
 * Every line_items candidate appears in exactly one logical table; candidates
 * of any other role never participate. Reading order is page, then top.
 */
export function linkCrossPageLineItemTables(
  classified: ClassifiedEvidenceTableCandidate[],
  evidence: DocumentEvidence,
): LogicalLineItemTable[] {
  const index: EvidenceIndex = new Map();
  for (const page of evidence.pages) {
    for (const element of page.elements) index.set(element.id, element);
  }

  const lineItemCandidates = classified
    .filter((candidate) => candidate.classification.role === "line_items")
    .sort(
      (left, right) =>
        left.page - right.page || candidateTop(left, index) - candidateTop(right, index),
    );

  const groups: OpenGroup[] = [];
  for (const candidate of lineItemCandidates) {
    const anchors = columnAnchorProfile(candidate, index);
    const height = averageRowHeight(candidate, index);

    let best: { group: OpenGroup; assessment: LinkAssessment } | null = null;
    for (const group of groups) {
      if (group.lastPage !== candidate.page - 1) continue;
      const previous = group.candidates.at(-1);
      if (!previous) continue;
      const assessment = assessLink(
        previous,
        candidate,
        group.anchorsByCandidate[previous.id] ?? [],
        anchors,
        averageRowHeight(previous, index),
        height,
        index,
      );
      if (assessment && (!best || assessment.matchedRatio > best.assessment.matchedRatio)) {
        best = { group, assessment };
      }
    }

    if (best) {
      best.group.candidates.push(candidate);
      best.group.links.push(best.assessment.link);
      best.group.anchorsByCandidate[candidate.id] = anchors;
      best.group.lastPage = candidate.page;
    } else {
      groups.push({
        candidates: [candidate],
        links: [],
        anchorsByCandidate: { [candidate.id]: anchors },
        lastPage: candidate.page,
      });
    }
  }

  return groups.map((group, groupIndex) => {
    const firstCandidateId = group.candidates[0]?.id ?? "";
    const rows: LogicalTableRow[] = [];
    for (const candidate of group.candidates) {
      candidate.rows.forEach((row, rowIndex) => {
        let kind: LogicalRowKind = "data";
        if (rowIndex === 0) {
          if (candidate.id === firstCandidateId) {
            kind = "header";
          } else {
            const link = group.links.find((entry) => entry.toCandidateId === candidate.id);
            if (link?.repeatedHeader) kind = "repeated-header";
          }
        }
        rows.push({
          sourceCandidateId: candidate.id,
          sourcePage: candidate.page,
          sourceRowIndex: row.rowIndex,
          kind,
          cells: row.cells,
          evidenceElementIds: row.cells.flatMap((cell) => cell.evidenceElementIds),
        });
      });
    }

    const columnAnchorGeometry: Record<string, string[]> = {};
    for (const [candidateId, anchors] of Object.entries(group.anchorsByCandidate)) {
      columnAnchorGeometry[candidateId] = anchors.map(round3);
    }

    return {
      id: `logical-${String(groupIndex + 1).padStart(3, "0")}`,
      role: "line_items",
      linkerVersion: CROSS_PAGE_LINKER_VERSION,
      pages: group.candidates.map((candidate) => candidate.page),
      candidateIds: group.candidates.map((candidate) => candidate.id),
      columnCount: Math.max(...group.candidates.map((candidate) => candidate.columnCount)),
      rowCount: rows.length,
      dataRowCount: rows.filter((row) => row.kind === "data").length,
      repeatedHeaderRowCount: rows.filter((row) => row.kind === "repeated-header").length,
      rows,
      columnAnchorGeometry,
      links: group.links,
    };
  });
}
