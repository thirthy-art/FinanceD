import type { AiInvoiceExtraction } from "./ai-extraction";
import { normalizeDateForInput } from "./date";
import type { EditableInvoiceLine } from "./invoice-lines";
import { findVendorIdentityMatches, type VendorIdentityCandidate } from "./vendor-identity";

export interface ExtractionDraftFields {
  vendorId: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  currency: string;
  netAmount: string;
  vatAmount: string;
  grossAmount: string;
  newVendorName?: string;
  newVendorTaxId?: string;
}

export type VendorApplyResolution =
  | { kind: "preserved" }
  | { kind: "selected"; vendor: VendorIdentityCandidate }
  | { kind: "new"; name: string; taxId: string }
  | { kind: "ambiguous"; candidates: VendorIdentityCandidate[]; matchedOn: "taxId" | "name" }
  | { kind: "none" };

export interface ApplyExtractionResult<T extends ExtractionDraftFields> {
  draft: T;
  appliedFields: string[];
  skippedFields: string[];
  vendorResolution: VendorApplyResolution;
}

export function applyExtractionToDraft<T extends ExtractionDraftFields>(
  current: T,
  extraction: AiInvoiceExtraction,
  vendors: VendorIdentityCandidate[],
): ApplyExtractionResult<T> {
  const draft = { ...current };
  const appliedFields: string[] = [];
  const skippedFields: string[] = [];
  let vendorResolution: VendorApplyResolution = { kind: "none" };

  const fill = (field: keyof T, label: string, value: string | null) => {
    if (value === null) return;
    draft[field] = value as T[keyof T];
    appliedFields.push(label);
  };

  const vendorName = extraction.vendorNormalized?.trim() || extraction.vendorOriginal?.trim() || "";
  const vendorTaxId = extraction.vendorTaxId?.trim() || "";
  if (vendorName || vendorTaxId) {
    if (current.vendorId.trim() || current.newVendorName?.trim() || current.newVendorTaxId?.trim()) {
      skippedFields.push("Vendor");
      vendorResolution = { kind: "preserved" };
    } else {
      const match = findVendorIdentityMatches(vendorName, vendorTaxId, vendors);
      if (match.candidates.length === 1) {
        draft.vendorId = String(match.candidates[0].id);
        appliedFields.push("Vendor");
        vendorResolution = { kind: "selected", vendor: match.candidates[0] };
      } else if (match.candidates.length > 1 && match.matchedOn) {
        vendorResolution = { kind: "ambiguous", candidates: match.candidates, matchedOn: match.matchedOn };
      } else {
        appliedFields.push("Vendor draft");
        vendorResolution = { kind: "new", name: vendorName, taxId: vendorTaxId };
      }
    }
  }

  fill("invoiceNumber", "Invoice number", extraction.invoiceNumber);

  for (const [field, label, extracted] of [
    ["invoiceDate", "Invoice date", extraction.invoiceDate],
    ["dueDate", "Due date", extraction.dueDate],
  ] as const) {
    if (extracted === null) continue;
    const normalized = normalizeDateForInput(extracted);
    if (!normalized) {
      skippedFields.push(`${label} (unrecognized date)`);
      continue;
    }
    fill(field, label, normalized);
  }

  fill("currency", "Currency", extraction.currency?.trim().toUpperCase() ?? null);
  fill("netAmount", "Net amount", extraction.netAmount);
  fill("vatAmount", "VAT amount", extraction.vatAmount);
  fill("grossAmount", "Gross amount", extraction.grossAmount);

  return { draft, appliedFields, skippedFields, vendorResolution };
}

export function aiLinesToEditable(lines: AiInvoiceExtraction["lines"]): EditableInvoiceLine[] {
  return lines.map((line) => ({
    lineNumber: line.lineNumber ?? "",
    descriptionOriginal: line.descriptionOriginal ?? "",
    description: line.description ?? "",
    quantity: line.quantity ?? "",
    unit: line.unit ?? "",
    unitPrice: line.unitPrice ?? "",
    netAmount: line.netAmount ?? "",
    vatRate: line.vatRate ?? "",
    vatAmount: line.vatAmount ?? "",
    grossAmount: line.grossAmount ?? "",
    sourcePage: line.sourcePage === null ? "" : String(line.sourcePage),
  }));
}

export function extractionLinesToEditable(extraction: AiInvoiceExtraction): EditableInvoiceLine[] {
  return aiLinesToEditable(extraction.lines);
}

export function invoiceLinesSignature(lines: EditableInvoiceLine[]): string {
  return JSON.stringify(lines.map((line) => ({
    lineNumber: line.lineNumber,
    descriptionOriginal: line.descriptionOriginal,
    description: line.description,
    quantity: line.quantity,
    unit: line.unit,
    unitPrice: line.unitPrice,
    netAmount: line.netAmount,
    vatRate: line.vatRate,
    vatAmount: line.vatAmount,
    grossAmount: line.grossAmount,
    sourcePage: line.sourcePage,
  })));
}

export function applyExtractionLines(
  currentLines: EditableInvoiceLine[],
  extractedLines: EditableInvoiceLine[],
  lastAppliedSignature: string | null,
): { lines: EditableInvoiceLine[]; applied: boolean; signature: string | null } {
  const currentIsLastApplied = lastAppliedSignature !== null && invoiceLinesSignature(currentLines) === lastAppliedSignature;
  if (currentLines.length > 0 && !currentIsLastApplied) {
    return { lines: currentLines, applied: false, signature: lastAppliedSignature };
  }
  const lines = extractedLines.map((line) => ({ ...line }));
  return { lines, applied: true, signature: invoiceLinesSignature(lines) };
}
