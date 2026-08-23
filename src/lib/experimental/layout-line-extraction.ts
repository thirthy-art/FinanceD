/**
 * Deterministic invoice-line extraction from logical cross-page line-item
 * tables. Header cells map to FinanceD line fields only through conservative
 * exact aliases; data cells normalize via parseDecimalInput (decimal strings,
 * no floating-point). Ambiguous headers, conflicting mappings, and uncertain
 * cell values are never guessed — they stay unmapped/null with diagnostics.
 * Results are runtime-only: nothing here writes to the database.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { AiInvoiceExtraction } from "../ai-extraction";
import { parseDecimalInput } from "../invoice-validation";
import { extractPdfLayoutEvidence } from "./pdf-layout-evidence";
import { clusterEvidenceTables } from "./layout-table-clustering";
import { classifyEvidenceTables } from "./layout-block-classification";
import {
  linkCrossPageLineItemTables,
  type LogicalLineItemTable,
  type LogicalTableRow,
} from "./layout-cross-page-continuity";
import type {
  DocumentEvidence,
  DocumentEvidenceElement,
} from "./document-evidence";

export const LAYOUT_LINE_EXTRACTOR_VERSION = "deterministic-layout-line-extraction-v1";

export type LayoutInvoiceLineField =
  | "lineNumber"
  | "descriptionOriginal"
  | "quantity"
  | "unit"
  | "unitPrice"
  | "netAmount"
  | "vatRate"
  | "vatAmount"
  | "grossAmount";

const NUMERIC_FIELDS: ReadonlySet<LayoutInvoiceLineField> = new Set([
  "quantity",
  "unitPrice",
  "netAmount",
  "vatRate",
  "vatAmount",
  "grossAmount",
]);

export interface DeterministicInvoiceLine {
  lineNumber: string | null;
  descriptionOriginal: string | null;
  quantity: string | null;
  unit: string | null;
  unitPrice: string | null;
  netAmount: string | null;
  vatRate: string | null;
  vatAmount: string | null;
  grossAmount: string | null;
  sourcePage: number;
  sourceCandidateId: string;
  sourceRowIndex: number;
  /** All evidence element IDs of the source row, in cell order. */
  rowEvidenceElementIds: string[];
  /** Evidence element IDs backing each resolved field value. */
  fieldEvidenceElementIds: Partial<Record<LayoutInvoiceLineField, string[]>>;
}

export interface LayoutLineExtractionDiagnostics {
  /** Raw header cell texts that mapped to no FinanceD field. */
  unmappedHeaderTexts: string[];
  /** Recognized but unsupported headers (e.g. discount columns). */
  unsupportedHeaderTexts: string[];
  /** Fields rejected because more than one column claimed them. */
  conflictingFields: LayoutInvoiceLineField[];
  /** Data cells whose value could not be normalized conservatively. */
  uncertainCellCount: number;
}

export interface LayoutLineExtractionResult {
  extractorVersion: typeof LAYOUT_LINE_EXTRACTOR_VERSION;
  logicalTableId: string | null;
  /** Header columnIndex to FinanceD field, after conflict rejection. */
  columnFields: Record<number, LayoutInvoiceLineField>;
  lines: DeterministicInvoiceLine[];
  diagnostics: LayoutLineExtractionDiagnostics;
  /**
   * Conservative usefulness gate: weak or structure-only output must not
   * displace the existing AI fallback.
   */
  useful: boolean;
}

type HeaderResolution =
  | { kind: "field"; field: LayoutInvoiceLineField }
  | { kind: "amount" }
  | { kind: "unsupported" }
  | null;

/**
 * Exact aliases, matched on the squashed normalized header form. Only headers
 * whose own wording makes the FinanceD field clear are listed; bare "Item",
 * "Price", and "Total" stay unmapped because their meaning varies across
 * invoices.
 */
const EXACT_HEADER_ALIASES: Readonly<Record<string, LayoutInvoiceLineField>> = {
  line: "lineNumber",
  lineno: "lineNumber",
  linenumber: "lineNumber",
  no: "lineNumber",
  nr: "lineNumber",
  pos: "lineNumber",
  position: "lineNumber",
  itemno: "lineNumber",
  itemnumber: "lineNumber",
  itemcode: "lineNumber",
  description: "descriptionOriginal",
  desc: "descriptionOriginal",
  itemdescription: "descriptionOriginal",
  particulars: "descriptionOriginal",
  details: "descriptionOriginal",
  product: "descriptionOriginal",
  service: "descriptionOriginal",
  qty: "quantity",
  quantity: "quantity",
  qte: "quantity",
  unit: "unit",
  uom: "unit",
  unitofmeasure: "unit",
  unitprice: "unitPrice",
  uprice: "unitPrice",
  priceperunit: "unitPrice",
  unitcost: "unitPrice",
  net: "netAmount",
  netamount: "netAmount",
  lineamount: "netAmount",
  "vat%": "vatRate",
  vatrate: "vatRate",
  "tax%": "vatRate",
  taxrate: "vatRate",
  "gst%": "vatRate",
  gstrate: "vatRate",
  vatamount: "vatAmount",
  taxamount: "vatAmount",
  gstamount: "vatAmount",
  vatamt: "vatAmount",
  taxamt: "vatAmount",
  gross: "grossAmount",
  grossamount: "grossAmount",
  linetotal: "grossAmount",
};

/** Recognized headers that must never be forced into a FinanceD field. */
const UNSUPPORTED_HEADERS: ReadonlySet<string> = new Set([
  "disc",
  "disc%",
  "discount",
  "discount%",
]);

function normalizeHeaderText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveHeader(text: string): HeaderResolution {
  if (text.trim() === "#") return { kind: "field", field: "lineNumber" };
  const squashed = normalizeHeaderText(text).replace(/\s+/g, "");
  if (squashed === "") return null;
  const exact = EXACT_HEADER_ALIASES[squashed];
  if (exact) return { kind: "field", field: exact };
  if (UNSUPPORTED_HEADERS.has(squashed)) return { kind: "unsupported" };
  if (squashed === "amount") return { kind: "amount" };
  return null;
}

interface ColumnMapping {
  columnFields: Map<number, LayoutInvoiceLineField>;
  unmappedHeaderTexts: string[];
  unsupportedHeaderTexts: string[];
  conflictingFields: LayoutInvoiceLineField[];
}

/**
 * Maps header columns to fields. Duplicate claims on one field reject every
 * claiming column. Bare "Amount" is a line net only in the narrow Qty × unit
 * price layout (a confidently mapped unitPrice column); otherwise it stays
 * unmapped rather than guessed.
 */
function mapHeaderColumns(
  headerCells: Array<{ columnIndex: number; text: string }>,
): ColumnMapping {
  const claims = new Map<number, LayoutInvoiceLineField>();
  const amountColumns: number[] = [];
  const unmappedHeaderTexts: string[] = [];
  const unsupportedHeaderTexts: string[] = [];
  const unmappedCells: Array<{ columnIndex: number; text: string }> = [];

  for (const cell of headerCells) {
    const resolution = resolveHeader(cell.text);
    if (resolution?.kind === "field") {
      claims.set(cell.columnIndex, resolution.field);
    } else if (resolution?.kind === "amount") {
      amountColumns.push(cell.columnIndex);
    } else if (resolution?.kind === "unsupported") {
      unsupportedHeaderTexts.push(cell.text);
    } else if (cell.text.trim() !== "") {
      unmappedHeaderTexts.push(cell.text);
      unmappedCells.push({ columnIndex: cell.columnIndex, text: cell.text });
    }
  }

  // Narrow known simple-invoice header: Item | Quantity/Qty | Rate | Amount.
  // Bare Item/Rate stay unmapped generally; only this coherent combination,
  // with no conflicting tax/discount/gross header, resolves them.
  const squashedOf = (text: string) => normalizeHeaderText(text).replace(/\s+/g, "");
  const squashedTexts = headerCells.map((cell) => squashedOf(cell.text));
  const itemColumns = unmappedCells.filter((cell) => squashedOf(cell.text) === "item");
  const rateColumns = unmappedCells.filter((cell) => squashedOf(cell.text) === "rate");
  const simpleInvoicePattern =
    itemColumns.length === 1 &&
    rateColumns.length === 1 &&
    amountColumns.length === 1 &&
    squashedTexts.some((text) => text === "quantity" || text === "qty") &&
    unsupportedHeaderTexts.length === 0 &&
    !squashedTexts.some((text) =>
      /^(tax|vat|gst)/.test(text) || /^gross/.test(text) || /^total/.test(text),
    );
  if (simpleInvoicePattern) {
    claims.set(itemColumns[0].columnIndex, "descriptionOriginal");
    claims.set(rateColumns[0].columnIndex, "unitPrice");
    for (let i = unmappedHeaderTexts.length - 1; i >= 0; i--) {
      const squashed = squashedOf(unmappedHeaderTexts[i]);
      if (squashed === "item" || squashed === "rate") unmappedHeaderTexts.splice(i, 1);
    }
  }

  const claimedFields = new Set(claims.values());
  const amountResolves =
    amountColumns.length === 1 &&
    claimedFields.has("unitPrice") &&
    !claimedFields.has("netAmount");
  for (const columnIndex of amountColumns) {
    if (amountResolves) {
      claims.set(columnIndex, "netAmount");
    } else {
      unmappedHeaderTexts.push(
        headerCells.find((c) => c.columnIndex === columnIndex)?.text ?? "",
      );
    }
  }

  const byField = new Map<LayoutInvoiceLineField, number[]>();
  for (const [columnIndex, field] of claims) {
    const columns = byField.get(field) ?? [];
    columns.push(columnIndex);
    byField.set(field, columns);
  }

  const columnFields = new Map<number, LayoutInvoiceLineField>();
  const conflictingFields: LayoutInvoiceLineField[] = [];
  for (const [field, columns] of byField) {
    if (columns.length === 1) {
      columnFields.set(columns[0], field);
    } else {
      conflictingFields.push(field);
    }
  }

  return { columnFields, unmappedHeaderTexts, unsupportedHeaderTexts, conflictingFields };
}

/** Conservative cell normalization; ambiguous formats become null. */
function normalizeNumericCell(text: string, field: LayoutInvoiceLineField): string | null {
  const candidate =
    field === "vatRate" ? text.trim().replace(/%+\s*$/, "") : text;
  try {
    return parseDecimalInput(candidate);
  } catch {
    return null;
  }
}

function buildEvidenceIndex(evidence: DocumentEvidence): Map<string, DocumentEvidenceElement> {
  const index = new Map<string, DocumentEvidenceElement>();
  for (const page of evidence.pages) {
    for (const element of page.elements) index.set(element.id, element);
  }
  return index;
}

const EMPTY_MAPPING: ColumnMapping = {
  columnFields: new Map<number, LayoutInvoiceLineField>(),
  unmappedHeaderTexts: [],
  unsupportedHeaderTexts: [],
  conflictingFields: [],
};

/** Extracts invoice-line candidates from one logical table in row order. */
export function extractInvoiceLinesFromLogicalTable(
  table: LogicalLineItemTable,
  evidence: DocumentEvidence,
): LayoutLineExtractionResult {
  const index = buildEvidenceIndex(evidence);
  const cellText = (evidenceElementIds: string[]): string =>
    evidenceElementIds.map((id) => index.get(id)?.text ?? "").join(" ").trim();

  // Header mapping is candidate-local: each physical candidate's header (or
  // repeated-header) row defines its own columnIndex → field mapping, because
  // continuation candidates can have different column layouts. A candidate
  // without any local header keeps an empty mapping — its raw column indexes
  // must not be read through another candidate's header.
  const mappingsByCandidate = new Map<string, ColumnMapping>();
  let firstHeaderRow: LogicalTableRow | undefined;
  const firstMapping: ColumnMapping = {
    columnFields: new Map<number, LayoutInvoiceLineField>(),
    unmappedHeaderTexts: [] as string[],
    unsupportedHeaderTexts: [] as string[],
    conflictingFields: [] as LayoutInvoiceLineField[],
  };
  for (const row of table.rows) {
    if (row.kind !== "header" && row.kind !== "repeated-header") continue;
    if (row.kind === "header" && firstHeaderRow === undefined) firstHeaderRow = row;
    if (mappingsByCandidate.has(row.sourceCandidateId)) continue;
    const mapping = mapHeaderColumns(
      row.cells.map((cell) => ({
        columnIndex: cell.columnIndex,
        text: cellText(cell.evidenceElementIds),
      })),
    );
    mappingsByCandidate.set(row.sourceCandidateId, mapping);
    if (row.kind === "header" && firstMapping.columnFields.size === 0) {
      firstMapping.columnFields = mapping.columnFields;
      firstMapping.unmappedHeaderTexts = mapping.unmappedHeaderTexts;
      firstMapping.unsupportedHeaderTexts = mapping.unsupportedHeaderTexts;
      firstMapping.conflictingFields = mapping.conflictingFields;
    }
  }

  let uncertainCellCount = 0;
  const lines: DeterministicInvoiceLine[] = [];

  for (const row of table.rows) {
    if (row.kind !== "data") continue;
    const mapping = mappingsByCandidate.get(row.sourceCandidateId) ?? EMPTY_MAPPING;
    const line: DeterministicInvoiceLine = {
      lineNumber: null,
      descriptionOriginal: null,
      quantity: null,
      unit: null,
      unitPrice: null,
      netAmount: null,
      vatRate: null,
      vatAmount: null,
      grossAmount: null,
      sourcePage: row.sourcePage,
      sourceCandidateId: row.sourceCandidateId,
      sourceRowIndex: row.sourceRowIndex,
      rowEvidenceElementIds: row.evidenceElementIds,
      fieldEvidenceElementIds: {},
    };
    for (const cell of row.cells) {
      const field = mapping.columnFields.get(cell.columnIndex);
      if (!field) continue;
      const text = cellText(cell.evidenceElementIds);
      if (text === "") continue;
      if (NUMERIC_FIELDS.has(field)) {
        const value = normalizeNumericCell(text, field);
        if (value === null) {
          uncertainCellCount += 1;
          continue;
        }
        line[field] = value;
      } else {
        line[field] = text;
      }
      line.fieldEvidenceElementIds[field] = cell.evidenceElementIds;
    }
    // Structure-only rows carry no field values and never become lines.
    const hasValue = (
      Object.keys(line.fieldEvidenceElementIds) as LayoutInvoiceLineField[]
    ).some((field) => line[field] !== null);
    if (hasValue) lines.push(line);
  }

  // Usefulness gate: at least one emitted line must carry BOTH a meaningful
  // identity/content field (description or confidently mapped line number)
  // AND deterministic numeric evidence. Numeric-only rows never displace the
  // existing AI fallback.
  const useful =
    firstHeaderRow !== undefined &&
    lines.some(
      (line) =>
        (line.descriptionOriginal !== null || line.lineNumber !== null) &&
        (line.quantity !== null ||
          line.unitPrice !== null ||
          line.netAmount !== null ||
          line.vatRate !== null ||
          line.vatAmount !== null ||
          line.grossAmount !== null),
    );

  return {
    extractorVersion: LAYOUT_LINE_EXTRACTOR_VERSION,
    logicalTableId: table.id,
    columnFields: Object.fromEntries(firstMapping.columnFields),
    lines,
    diagnostics: {
      unmappedHeaderTexts: firstMapping.unmappedHeaderTexts,
      unsupportedHeaderTexts: firstMapping.unsupportedHeaderTexts,
      conflictingFields: firstMapping.conflictingFields,
      uncertainCellCount,
    },
    useful,
  };
}

/**
 * Full deterministic pipeline over born-digital PDF bytes. Throws on hard
 * layout/parsing failure; callers treat that as non-fatal and fall back to
 * the existing AI path.
 */
export async function extractDeterministicLayoutInvoiceLines(
  pdfBytes: Buffer | Uint8Array,
): Promise<LayoutLineExtractionResult> {
  // Under Next.js bundling, pdfjs resolves its fake worker relative to the
  // bundled chunk, where the worker file is not emitted. Pin it to the real
  // file in node_modules, as the development layout probe already does.
  GlobalWorkerOptions.workerSrc = pathToFileURL(
    path.join(process.cwd(), "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.mjs"),
  ).href;

  const evidence = await extractPdfLayoutEvidence(pdfBytes);
  const classified = classifyEvidenceTables(clusterEvidenceTables(evidence), evidence);
  const logicalTables = linkCrossPageLineItemTables(classified, evidence);

  // More than one logical line-item table is ambiguous; refuse to pick one.
  if (logicalTables.length !== 1) {
    return {
      extractorVersion: LAYOUT_LINE_EXTRACTOR_VERSION,
      logicalTableId: null,
      columnFields: {},
      lines: [],
      diagnostics: {
        unmappedHeaderTexts: [],
        unsupportedHeaderTexts: [],
        conflictingFields: [],
        uncertainCellCount: 0,
      },
      useful: false,
    };
  }
  return extractInvoiceLinesFromLogicalTable(logicalTables[0], evidence);
}

/**
 * Merges deterministic lines with AI lines. Confident deterministic non-null
 * values always win. AI fills null fields only when positional alignment is
 * safe (equal line counts, document order); otherwise AI line values are
 * ignored entirely rather than guessed into wrong rows.
 */
export function mergeDeterministicWithAiLines(
  deterministicLines: DeterministicInvoiceLine[],
  aiLines: AiInvoiceExtraction["lines"],
): AiInvoiceExtraction["lines"] {
  const aligned = aiLines.length === deterministicLines.length;
  const pick = (deterministic: string | null, ai: string | null | undefined): string | null =>
    deterministic ?? ai ?? null;
  return deterministicLines.map((line, index) => {
    const ai = aligned ? aiLines[index] : undefined;
    return {
      lineNumber: pick(line.lineNumber, ai?.lineNumber),
      descriptionOriginal: pick(line.descriptionOriginal, ai?.descriptionOriginal),
      description: ai?.description ?? null,
      quantity: pick(line.quantity, ai?.quantity),
      unit: pick(line.unit, ai?.unit),
      unitPrice: pick(line.unitPrice, ai?.unitPrice),
      netAmount: pick(line.netAmount, ai?.netAmount),
      vatRate: pick(line.vatRate, ai?.vatRate),
      vatAmount: pick(line.vatAmount, ai?.vatAmount),
      grossAmount: pick(line.grossAmount, ai?.grossAmount),
      sourcePage: line.sourcePage,
    };
  });
}
