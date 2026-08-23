/**
 * Deterministic block-role classification for experimental table candidates.
 * Uses only evidence already present in the prototype: referenced element
 * text, row/column shape, simple numeric patterns, small English concept
 * groups, and page position. Weak evidence maps to "unknown" deliberately.
 */
import { evidenceNumber, type DocumentEvidence, type DocumentEvidenceElement } from "./document-evidence";
import type { EvidenceTableCandidate } from "./layout-table-clustering";

export const TABLE_BLOCK_ROLES = [
  "line_items",
  "invoice_metadata",
  "totals",
  "footer_or_payment",
  "unknown",
] as const;

export type TableBlockRole = (typeof TABLE_BLOCK_ROLES)[number];

export interface TableBlockClassification {
  role: TableBlockRole;
  /** Short stable diagnostic token, not a user-facing explanation. */
  reason: string;
}

export type ClassifiedEvidenceTableCandidate = EvidenceTableCandidate & {
  classification: TableBlockClassification;
};

export const LINE_ITEM_HEADER_CONCEPTS = [
  "description",
  "item",
  "qty",
  "quantity",
  "unit",
  "price",
  "rate",
  "amount",
  "hours",
  "service",
  "product",
];
const TOTALS_CONCEPTS = ["total", "subtotal", "grand", "balance", "vat", "tax"];
const METADATA_CONCEPTS = [
  "invoice",
  "number",
  "date",
  "bill",
  "ship",
  "address",
  "customer",
  "client",
  "vendor",
  "supplier",
  "order",
  "reference",
];
const FOOTER_STRONG_CONCEPTS = [
  "bank",
  "iban",
  "swift",
  "bic",
  "payment",
  "paid",
  "remit",
  "remittance",
  "beneficiary",
  "routing",
];
const FOOTER_WEAK_CONCEPTS = ["thank", "account"];

/** Cells whose whole text is a plain number with optional currency/percent marks. */
export function isNumericLike(text: string): boolean {
  return /^[$€£¥₪]?[0-9\s.,]+%?$/.test(text.trim());
}

export function tokensOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

function conceptHits(
  tokens: string[],
  concepts: readonly string[],
  into: Set<string> = new Set(),
): Set<string> {
  for (const token of tokens) {
    if (concepts.includes(token)) into.add(token);
  }
  return into;
}

function hasConcept(tokens: string[], concepts: readonly string[]): boolean {
  return tokens.some((token) => concepts.includes(token));
}

interface CandidateRowFacts {
  cells: string[];
  tokens: string[];
  hasNumericCell: boolean;
}

function rowFacts(
  candidate: EvidenceTableCandidate,
  index: Map<string, DocumentEvidenceElement>,
): CandidateRowFacts[] {
  return candidate.rows.map((row) => {
    const cells = row.cells.map((cell) =>
      cell.evidenceElementIds.map((id) => index.get(id)?.text ?? "").join(" "),
    );
    return {
      cells,
      tokens: cells.flatMap(tokensOf),
      hasNumericCell: cells.some((cell) => isNumericLike(cell)),
    };
  });
}

function candidateNormalizedTop(
  candidate: EvidenceTableCandidate,
  index: Map<string, DocumentEvidenceElement>,
): number {
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

export function classifyTableCandidate(
  candidate: EvidenceTableCandidate,
  index: Map<string, DocumentEvidenceElement>,
): TableBlockClassification {
  const rows = rowFacts(candidate, index);
  if (rows.length === 0) return { role: "unknown", reason: "insufficient evidence" };

  // Line items: a recognizable header row plus a numeric-dense data grid.
  // Requiring combined evidence keeps plain "Amount"/"Total" headers below.
  const dataCells = rows.slice(1).flatMap((row) => row.cells);
  if (rows.length >= 2 && dataCells.length > 0) {
    const headerHits = conceptHits(rows[0].tokens, LINE_ITEM_HEADER_CONCEPTS);
    const numericRatio = dataCells.filter((cell) => isNumericLike(cell)).length / dataCells.length;
    if (headerHits.size >= 2 && numericRatio >= 0.4) {
      return { role: "line_items", reason: "line-item header + numeric rows" };
    }
  }

  // Totals: totals labels across the majority of rows, with numeric values.
  const totalsRows = rows.filter((row) => hasConcept(row.tokens, TOTALS_CONCEPTS));
  if (
    totalsRows.length / rows.length >= 0.5 &&
    totalsRows.some((row) => row.hasNumericCell)
  ) {
    return { role: "totals", reason: "totals labels with values" };
  }

  // Metadata: label/value rows dominated by invoice metadata terms.
  const metaRows = rows.filter((row) => hasConcept(row.tokens, METADATA_CONCEPTS));
  if (metaRows.length / rows.length >= 0.5) {
    return { role: "invoice_metadata", reason: "metadata label rows" };
  }

  // Footer/payment: strong payment terms anywhere, or weak footer terms only
  // when the candidate sits in the bottom quarter of the page.
  const allTokens = rows.flatMap((row) => row.tokens);
  const strongHits = conceptHits(allTokens, FOOTER_STRONG_CONCEPTS);
  if (strongHits.size >= 1) {
    return { role: "footer_or_payment", reason: "payment/footer terms" };
  }
  const weakHits = conceptHits(allTokens, FOOTER_WEAK_CONCEPTS);
  if (weakHits.size >= 1 && candidateNormalizedTop(candidate, index) >= 0.75) {
    return { role: "footer_or_payment", reason: "footer terms near page bottom" };
  }

  return { role: "unknown", reason: "insufficient evidence" };
}

export function classifyEvidenceTables(
  candidates: EvidenceTableCandidate[],
  evidence: DocumentEvidence,
): ClassifiedEvidenceTableCandidate[] {
  const index = new Map<string, DocumentEvidenceElement>();
  for (const page of evidence.pages) {
    for (const element of page.elements) index.set(element.id, element);
  }
  return candidates.map((candidate) => ({
    ...candidate,
    classification: classifyTableCandidate(candidate, index),
  }));
}
