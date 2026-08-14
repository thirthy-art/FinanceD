import type { AiInvoiceExtraction } from "./ai-extraction";
import { normalizeDateForInput } from "./date";
import type { EditableInvoiceLine } from "./invoice-lines";

export interface ExtractionDraftFields {
  vendorId: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  currency: string;
  netAmount: string;
  vatAmount: string;
  grossAmount: string;
}

interface VendorOption { id: number; name: string }

export interface ApplyExtractionResult<T extends ExtractionDraftFields> {
  draft: T;
  appliedFields: string[];
  skippedFields: string[];
  unmatchedVendorName: string | null;
}

export function applyExtractionToDraft<T extends ExtractionDraftFields>(
  current: T,
  extraction: AiInvoiceExtraction,
  vendors: VendorOption[],
): ApplyExtractionResult<T> {
  const draft = { ...current };
  const appliedFields: string[] = [];
  const skippedFields: string[] = [];
  let unmatchedVendorName: string | null = null;

  const fill = (field: keyof T, label: string, value: string | null) => {
    if (!value) return;
    if (String(current[field]).trim()) {
      skippedFields.push(label);
      return;
    }
    draft[field] = value as T[keyof T];
    appliedFields.push(label);
  };

  const vendorNames = [extraction.vendorOriginal, extraction.vendorNormalized]
    .filter((value): value is string => Boolean(value?.trim()));
  if (vendorNames.length > 0) {
    if (current.vendorId.trim()) {
      skippedFields.push("Vendor");
    } else {
      const match = vendors.find((vendor) =>
        vendorNames.some((name) => vendor.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase())
      );
      if (match) {
        draft.vendorId = String(match.id);
        appliedFields.push("Vendor");
      } else {
        unmatchedVendorName = extraction.vendorOriginal ?? extraction.vendorNormalized;
      }
    }
  }

  fill("invoiceNumber", "Invoice number", extraction.invoiceNumber);

  for (const [field, label, extracted] of [
    ["invoiceDate", "Invoice date", extraction.invoiceDate],
    ["dueDate", "Due date", extraction.dueDate],
  ] as const) {
    if (!extracted) continue;
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

  return { draft, appliedFields, skippedFields, unmatchedVendorName };
}

export function extractionLinesToEditable(extraction: AiInvoiceExtraction): EditableInvoiceLine[] {
  return extraction.lines.map((line) => ({
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
