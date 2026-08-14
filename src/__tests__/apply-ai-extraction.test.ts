import { describe, expect, it } from "vitest";
import type { AiInvoiceExtraction } from "@/src/lib/ai-extraction";
import { applyExtractionLines, applyExtractionToDraft, extractionLinesToEditable } from "@/src/lib/apply-ai-extraction";

const extraction: AiInvoiceExtraction = {
  vendorOriginal: "ACME LTD",
  vendorNormalized: "Acme Ltd",
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

describe("applying AI extraction", () => {
  it("fills empty fields, matches a vendor case-insensitively, and preserves manual values", () => {
    const result = applyExtractionToDraft({
      vendorId: "",
      invoiceNumber: "MANUAL-7",
      invoiceDate: "",
      dueDate: "",
      currency: "",
      netAmount: "",
      vatAmount: "5.00",
      grossAmount: "",
    }, extraction, [{ id: 9, name: "acme ltd" }]);

    expect(result.draft.vendorId).toBe("9");
    expect(result.draft.invoiceNumber).toBe("MANUAL-7");
    expect(result.draft.invoiceDate).toBe("2026-07-15");
    expect(result.draft.currency).toBe("USD");
    expect(result.draft.netAmount).toBe("100.10");
    expect(result.draft.vatAmount).toBe("5.00");
    expect(result.skippedFields).toEqual(expect.arrayContaining(["Invoice number", "VAT amount"]));
  });

  it("reapplying the same extraction replaces its lines without duplicating them", () => {
    const extractedLines = extractionLinesToEditable(extraction);
    const first = applyExtractionLines([], extractedLines, null);
    const second = applyExtractionLines(first.lines, extractedLines, first.signature);

    expect(first.lines).toHaveLength(1);
    expect(second.lines).toHaveLength(1);
    expect(second.applied).toBe(true);
  });
});
