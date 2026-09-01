import { describe, expect, it, vi } from "vitest";
import type { AiInvoiceExtraction } from "@/src/lib/ai-extraction";
import { AiInvoiceExtractionSchema } from "@/src/lib/ai-extraction";
import { applyExtractionLines, applyExtractionToDraft, extractionLinesToEditable, invoiceLinesSignature, persistNewVendorResolution } from "@/src/lib/apply-ai-extraction";
import { sumInvoiceLineAmounts } from "@/src/lib/invoice-lines";

const extraction: AiInvoiceExtraction = {
  vendorOriginal: "ACME LTD",
  vendorNormalized: "Acme Ltd",
  vendorTaxId: "CY 123-456",
  invoiceNumber: "AI-42",
  invoiceDate: "15/07/2026",
  dueDate: "2026-08-15",
  currency: "usd",
  netAmount: "100.10",
  vatAmount: "20.02",
  grossAmount: "120.12",
  lines: [{
    lineNumber: "1",
    descriptionOriginal: "Servicii",
    description: "Services",
    quantity: "2.5",
    unit: "hours",
    unitPrice: "40.04",
    netAmount: "100.10",
    vatRate: "20",
    vatAmount: "20.02",
    grossAmount: "120.12",
    sourcePage: 1,
  }],
};

const currentDraft = {
  vendorId: "",
  invoiceNumber: "OCR-7",
  invoiceDate: "2026-01-01",
  dueDate: "2026-01-31",
  currency: "EUR",
  netAmount: "90.00",
  vatAmount: "18.00",
  grossAmount: "108.00",
};

function headerExtraction(overrides: Partial<AiInvoiceExtraction>): AiInvoiceExtraction {
  return {
    vendorOriginal: null,
    vendorNormalized: null,
    vendorTaxId: null,
    invoiceNumber: null,
    invoiceDate: null,
    dueDate: null,
    currency: null,
    netAmount: null,
    vatAmount: null,
    grossAmount: null,
    lines: [],
    ...overrides,
  };
}

describe("applying AI extraction", () => {
  it("accepts and returns an explicitly extracted vendor VAT/Tax ID", () => {
    expect(AiInvoiceExtractionSchema.parse(extraction).vendorTaxId).toBe("CY 123-456");
  });

  it("replaces non-empty invoice-header values with reviewed non-null AI values", () => {
    const result = applyExtractionToDraft(currentDraft, extraction, [
      { id: 9, name: "acme ltd", taxId: "CY123456", invoiceCount: 2 },
    ]);

    expect(result.draft).toMatchObject({
      vendorId: "9",
      invoiceNumber: "AI-42",
      invoiceDate: "2026-07-15",
      dueDate: "2026-08-15",
      currency: "USD",
      netAmount: "100.10",
      vatAmount: "20.02",
      grossAmount: "120.12",
    });
    expect(result.appliedFields).toEqual(expect.arrayContaining([
      "Invoice number", "Invoice date", "Due date", "Currency", "Net amount", "VAT amount", "Gross amount",
    ]));
  });

  it("selects an existing vendor by normalized Tax ID", () => {
    const result = applyExtractionToDraft(currentDraft, extraction, [
      { id: 7, name: "Other display name", taxId: "CY123456" },
    ]);

    expect(result.vendorResolution).toMatchObject({ kind: "selected", vendor: { id: 7 } });
    expect(result.draft.vendorId).toBe("7");
  });

  it("gives Tax ID precedence over an exact normalized name match", () => {
    const result = applyExtractionToDraft(currentDraft, extraction, [
      { id: 7, name: "Different vendor", taxId: "CY123456" },
      { id: 8, name: "  acme   ltd  ", taxId: "CY999999" },
    ]);

    expect(result.vendorResolution).toMatchObject({ kind: "selected", vendor: { id: 7 } });
  });

  it("falls back to an exact normalized name match when Tax ID has no match", () => {
    const result = applyExtractionToDraft(currentDraft, extraction, [
      { id: 8, name: "  acme   ltd  ", taxId: "CY999999" },
    ]);

    expect(result.vendorResolution).toMatchObject({ kind: "selected", vendor: { id: 8 } });
  });

  it("does not guess or request creation when identity matching is ambiguous", async () => {
    const result = applyExtractionToDraft(currentDraft, extraction, [
      { id: 7, name: "Acme One", taxId: "CY123456" },
      { id: 8, name: "Acme Two", taxId: "CY 123-456" },
    ]);
    const request = vi.fn();
    const persisted = await persistNewVendorResolution(result.vendorResolution, request);

    expect(persisted).toMatchObject({ kind: "ambiguous", matchedOn: "taxId" });
    expect(request).not.toHaveBeenCalled();
  });

  it("persists an unknown extracted vendor and returns a selectable vendorId", async () => {
    const request = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: 42, name: "New Supplier", taxId: "CY-42", normalizedTaxId: "CY42" }),
    });

    const result = await persistNewVendorResolution(
      { kind: "new", name: "New Supplier", taxId: "CY-42" },
      request,
    );

    expect(result).toMatchObject({ kind: "selected", vendor: { id: 42, name: "New Supplier" } });
    expect(request).toHaveBeenCalledWith("/api/settings/vendors", expect.objectContaining({ method: "POST" }));
  });

  it("keeps server-side ambiguity as a user choice instead of creating or guessing", async () => {
    const candidates = [
      { id: 11, name: "Duplicate", taxId: null },
      { id: 12, name: " duplicate ", taxId: null },
    ];
    const result = await persistNewVendorResolution(
      { kind: "new", name: "Duplicate", taxId: "" },
      async () => ({
        ok: false,
        status: 409,
        json: async () => ({ candidates, matchedOn: "name" }),
      }),
    );

    expect(result).toEqual({ kind: "ambiguous", candidates, matchedOn: "name" });
  });

  it("fills an empty invoice-header field with a non-null AI value", () => {
    const result = applyExtractionToDraft(
      { ...currentDraft, invoiceNumber: "" },
      headerExtraction({ invoiceNumber: "AI-99" }),
      [],
    );
    expect(result.draft.invoiceNumber).toBe("AI-99");
    expect(result.appliedFields).toContain("Invoice number");
  });

  it("preserves existing invoice-header fields when the AI value is null", () => {
    const result = applyExtractionToDraft(currentDraft, headerExtraction({}), []);
    expect(result.draft).toEqual(currentDraft);
    expect(result.appliedFields).toEqual([]);
  });

  it("normalizes recognized AI dates before replacing current dates", () => {
    const result = applyExtractionToDraft(
      currentDraft,
      headerExtraction({ invoiceDate: "15/07/2026", dueDate: "2026/08/15" }),
      [],
    );
    expect(result.draft.invoiceDate).toBe("2026-07-15");
    expect(result.draft.dueDate).toBe("2026-08-15");
  });

  it("preserves an existing date and warning when the AI date is unrecognized", () => {
    const result = applyExtractionToDraft(
      currentDraft,
      headerExtraction({ invoiceDate: "July 15, 2026" }),
      [],
    );
    expect(result.draft.invoiceDate).toBe("2026-01-01");
    expect(result.skippedFields).toContain("Invoice date (unrecognized date)");
  });

  it("replaces an untouched deterministic initial-line baseline", () => {
    const extractedLines = extractionLinesToEditable(extraction);
    const deterministicLines = [{ ...extractedLines[0], description: "Deterministic description" }];
    const result = applyExtractionLines(
      deterministicLines,
      extractedLines,
      null,
      invoiceLinesSignature(deterministicLines),
    );

    expect(result.applied).toBe(true);
    expect(result.lines).toEqual(extractedLines);
  });

  it("keeps deterministic initial lines protected after a manual edit", () => {
    const extractedLines = extractionLinesToEditable(extraction);
    const deterministicLines = [{ ...extractedLines[0], description: "Deterministic description" }];
    const deterministicSignature = invoiceLinesSignature(deterministicLines);
    const editedLines = [{ ...deterministicLines[0], description: "Manual description" }];
    const result = applyExtractionLines(editedLines, extractedLines, null, deterministicSignature);

    expect(result.applied).toBe(false);
    expect(result.lines).toBe(editedLines);
    expect(result.lines[0].description).toBe("Manual description");
  });

  it("keeps persisted or otherwise existing invoice lines protected", () => {
    const extractedLines = extractionLinesToEditable(extraction);
    const existingLines = [{ ...extractedLines[0], description: "Persisted description" }];
    const result = applyExtractionLines(existingLines, extractedLines, null);

    expect(result.applied).toBe(false);
    expect(result.lines).toBe(existingLines);
    expect(result.lines[0].description).toBe("Persisted description");
  });

  it("reapplying the same extraction replaces its lines without duplicating them", () => {
    const extractedLines = extractionLinesToEditable(extraction);
    const first = applyExtractionLines([], extractedLines, null);
    const second = applyExtractionLines(first.lines, extractedLines, first.signature);

    expect(first.lines).toHaveLength(1);
    expect(second.lines).toHaveLength(1);
    expect(second.applied).toBe(true);
  });

  it("sums line amounts as decimal strings without floating-point rounding", () => {
    const lines = extractionLinesToEditable({
      ...extraction,
      lines: [
        { ...extraction.lines[0], netAmount: "0.1" },
        { ...extraction.lines[0], lineNumber: "2", netAmount: "0.2" },
      ],
    });

    expect(sumInvoiceLineAmounts(lines)).toEqual({ sum: "0.3", invalidLineNumbers: [] });
  });
});
