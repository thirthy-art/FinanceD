import type { AiInvoiceExtraction } from "./ai-extraction";
import { normalizeDateForInput } from "./date";
import { fillMissingLineNumbers, type EditableInvoiceLine } from "./invoice-lines";
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

type VendorResolutionRequest = (
  input: string,
  init: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "json">>;

/**
 * Persists only vendor resolutions that identity matching has determined are new.
 * The server repeats identity matching inside the active-company boundary before
 * creating anything, so this remains safe when the browser's vendor list is stale.
 */
export async function persistNewVendorResolution(
  resolution: VendorApplyResolution,
  request: VendorResolutionRequest = fetch,
): Promise<VendorApplyResolution> {
  if (resolution.kind !== "new") return resolution;

  const response = await request("/api/settings/vendors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: resolution.name,
      taxId: resolution.taxId || undefined,
      creationSource: "ai_extraction",
    }),
  });
  const body = await response.json() as {
    error?: unknown;
    id?: number;
    name?: string;
    taxId?: string | null;
    normalizedTaxId?: string | null;
    vendorStatus?: "draft" | "active";
    candidates?: VendorIdentityCandidate[];
    matchedOn?: "taxId" | "name";
  };

  if (response.status === 409 && body.candidates?.length && body.matchedOn) {
    return { kind: "ambiguous", candidates: body.candidates, matchedOn: body.matchedOn };
  }
  if (!response.ok || !body.id || !body.name) {
    throw new Error(typeof body.error === "string" ? body.error : "Vendor could not be resolved.");
  }

  return {
    kind: "selected",
    vendor: {
      id: body.id,
      name: body.name,
      taxId: body.taxId ?? null,
      normalizedTaxId: body.normalizedTaxId ?? null,
      vendorStatus: body.vendorStatus,
      invoiceCount: 0,
    },
  };
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

export function extractionLinesToEditable(extraction: AiInvoiceExtraction): EditableInvoiceLine[] {
  return fillMissingLineNumbers(extraction.lines.map((line) => ({
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
    recognitionTreatment: "Immediate" as const,
    recognitionStartDate: "",
    recognitionEndDate: "",
    accountingAccountNumber: "",
    prepaidAccountNumber: "",
  })));
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
  deterministicInitialSignature: string | null = null,
): { lines: EditableInvoiceLine[]; applied: boolean; signature: string | null } {
  const currentSignature = invoiceLinesSignature(currentLines);
  const currentIsLastApplied = lastAppliedSignature !== null && currentSignature === lastAppliedSignature;
  const currentIsUntouchedDeterministic = deterministicInitialSignature !== null
    && currentSignature === deterministicInitialSignature;
  if (currentLines.length > 0 && !currentIsLastApplied && !currentIsUntouchedDeterministic) {
    return { lines: currentLines, applied: false, signature: lastAppliedSignature };
  }
  const lines = extractedLines.map((line) => ({ ...line }));
  return { lines, applied: true, signature: invoiceLinesSignature(lines) };
}
