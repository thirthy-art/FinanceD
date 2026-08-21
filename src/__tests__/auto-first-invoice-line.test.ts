import { describe, it, expect } from "vitest";
import { parseInvoiceFields } from "../lib/extract";
import { buildTextExtractionFallbackLine } from "../lib/local-invoice-parser";
import { emptyEditableInvoiceLine } from "../lib/invoice-lines";

// ── Case 1: Fresh invoice with all three extracted amounts ─────────────────────

describe("Case 1 — fresh invoice creates a fallback line", () => {
  it("creates one editable line with net=4500 vat=0 gross=4500", () => {
    const extracted = parseInvoiceFields(
      "Subtotal: 4500\nVAT Amount: 0\nTotal: 4500",
    ) as Record<string, string>;
    const result = buildTextExtractionFallbackLine(0, null, null, null, extracted);
    expect(result).not.toBeNull();
    expect(result!.netAmount).toBe("4500");
    expect(result!.vatAmount).toBe("0");
    expect(result!.grossAmount).toBe("4500");
  });

  it("line has empty fields for quantity, unitPrice, vatRate, sourcePage, etc.", () => {
    const extracted = { netAmount: "4500", vatAmount: "0", grossAmount: "4500" };
    const result = buildTextExtractionFallbackLine(0, null, null, null, extracted);
    expect(result).not.toBeNull();
    const empty = emptyEditableInvoiceLine();
    expect(result!.lineNumber).toBe(empty.lineNumber);
    expect(result!.quantity).toBe(empty.quantity);
    expect(result!.unit).toBe(empty.unit);
    expect(result!.unitPrice).toBe(empty.unitPrice);
    expect(result!.vatRate).toBe(empty.vatRate);
    expect(result!.sourcePage).toBe(empty.sourcePage);
    expect(result!.recognitionTreatment).toBe("Immediate");
    expect(result!.accountingAccountNumber).toBe(empty.accountingAccountNumber);
    expect(result!.prepaidAccountNumber).toBe(empty.prepaidAccountNumber);
  });
});

// ── Case 2: Persisted line already exists ─────────────────────────────────────

describe("Case 2 — persisted line already exists", () => {
  it("returns null when one persisted line is present", () => {
    const extracted = { netAmount: "4500", vatAmount: "0", grossAmount: "4500" };
    const result = buildTextExtractionFallbackLine(1, null, null, null, extracted);
    expect(result).toBeNull();
  });

  it("returns null when multiple persisted lines are present", () => {
    const extracted = { netAmount: "4500", vatAmount: "0", grossAmount: "4500" };
    const result = buildTextExtractionFallbackLine(3, null, null, null, extracted);
    expect(result).toBeNull();
  });
});

// ── Case 3: Regeneration guard — previously saved header ──────────────────────

describe("Case 3 — regeneration guard: no fallback when header amounts are persisted", () => {
  it("returns null when all three header amounts are persisted (zero lines)", () => {
    const extracted = { netAmount: "4500", vatAmount: "0", grossAmount: "4500" };
    const result = buildTextExtractionFallbackLine(0, "4500", "0", "4500", extracted);
    expect(result).toBeNull();
  });

  it("returns null when only netAmount is persisted", () => {
    const extracted = { netAmount: "4500", vatAmount: "0", grossAmount: "4500" };
    const result = buildTextExtractionFallbackLine(0, "4500", null, null, extracted);
    expect(result).toBeNull();
  });

  it("returns null when only vatAmount is persisted", () => {
    const extracted = { netAmount: "4500", vatAmount: "0", grossAmount: "4500" };
    const result = buildTextExtractionFallbackLine(0, null, "0", null, extracted);
    expect(result).toBeNull();
  });

  it("returns null when only grossAmount is persisted", () => {
    const extracted = { netAmount: "4500", vatAmount: "0", grossAmount: "4500" };
    const result = buildTextExtractionFallbackLine(0, null, null, "4500", extracted);
    expect(result).toBeNull();
  });
});

// ── Case 4: Incomplete extraction ─────────────────────────────────────────────

describe("Case 4 — incomplete extraction yields no fallback", () => {
  it("returns null when VAT is missing from extracted fields", () => {
    const extracted = parseInvoiceFields("Subtotal: 4500\nTotal: 4500") as Record<string, string>;
    // Verify parser did not produce a vatAmount for this input
    expect("vatAmount" in extracted).toBe(false);
    const result = buildTextExtractionFallbackLine(0, null, null, null, extracted);
    expect(result).toBeNull();
  });

  it("returns null when gross is missing from extracted fields", () => {
    const result = buildTextExtractionFallbackLine(0, null, null, null, { netAmount: "4500", vatAmount: "0" });
    expect(result).toBeNull();
  });

  it("returns null when net is missing from extracted fields", () => {
    const result = buildTextExtractionFallbackLine(0, null, null, null, { vatAmount: "0", grossAmount: "4500" });
    expect(result).toBeNull();
  });

  it("returns null when extractedFields is empty", () => {
    const result = buildTextExtractionFallbackLine(0, null, null, null, {});
    expect(result).toBeNull();
  });
});

// ── Case 5: Zero VAT is a valid populated amount ──────────────────────────────

describe("Case 5 — zero VAT is valid", () => {
  it('treats "0" as a valid populated VAT amount', () => {
    const result = buildTextExtractionFallbackLine(
      0, null, null, null,
      { netAmount: "4500", vatAmount: "0", grossAmount: "4500" },
    );
    expect(result).not.toBeNull();
    expect(result!.vatAmount).toBe("0");
  });

  it('treats "0.00" as a valid populated VAT amount', () => {
    const result = buildTextExtractionFallbackLine(
      0, null, null, null,
      { netAmount: "4500", vatAmount: "0.00", grossAmount: "4500" },
    );
    expect(result).not.toBeNull();
    expect(result!.vatAmount).toBe("0.00");
  });

  it("parser produces zero VAT from text with explicit zero tax line", () => {
    const extracted = parseInvoiceFields(
      "Subtotal: 4500\nVAT Amount: 0.00\nTotal: 4500",
    ) as Record<string, string>;
    expect(extracted.vatAmount).toBe("0.00");
    const result = buildTextExtractionFallbackLine(0, null, null, null, extracted);
    expect(result).not.toBeNull();
    expect(result!.vatAmount).toBe("0.00");
  });
});

// ── Description heuristic ─────────────────────────────────────────────────────

describe("Description heuristic — parseLineDescription via parseInvoiceFields", () => {
  it("extracts a plausible description following a Description heading", () => {
    const fields = parseInvoiceFields(
      "Net Amount: 4500\nVAT: 0\nTotal: 4500\nDescription:\nConsulting Services",
    );
    expect(fields.lineDescription).toBe("Consulting Services");
  });

  it("extracts a plausible description following a Service heading", () => {
    const fields = parseInvoiceFields(
      "Subtotal: 4500\nVAT: 0\nTotal: 4500\nService:\nSoftware Development",
    );
    expect(fields.lineDescription).toBe("Software Development");
  });

  it("extracts a description following a Details heading", () => {
    const fields = parseInvoiceFields(
      "Subtotal: 1000\nVAT: 200\nTotal: 1200\nDetails:\nAnnual maintenance",
    );
    expect(fields.lineDescription).toBe("Annual maintenance");
  });

  it("rejects a total label line after Description heading", () => {
    const fields = parseInvoiceFields(
      "Description:\nTotal: 4500\nVAT: 0\nNet: 4500",
    );
    expect(fields.lineDescription).toBeUndefined();
  });

  it("rejects an invoice number line after Description heading", () => {
    const fields = parseInvoiceFields(
      "Description:\nInvoice Number: 123\nSubtotal: 4500\nVAT: 0\nTotal: 4500",
    );
    expect(fields.lineDescription).toBeUndefined();
  });

  it("rejects a purely numeric amount line as description candidate", () => {
    const fields = parseInvoiceFields(
      "Description:\n4500\nSubtotal: 4500\nVAT: 0\nTotal: 4500",
    );
    expect(fields.lineDescription).toBeUndefined();
  });

  it("returns undefined when no Description/Service/Item/Details heading is present", () => {
    const fields = parseInvoiceFields(
      "Invoice No: 123\nNet Amount: 4500\nVAT: 0\nTotal: 4500",
    );
    expect(fields.lineDescription).toBeUndefined();
  });

  it("description is stored in descriptionOriginal, not description", () => {
    const result = buildTextExtractionFallbackLine(
      0, null, null, null,
      { netAmount: "4500", vatAmount: "0", grossAmount: "4500", lineDescription: "Consulting Services" },
    );
    expect(result).not.toBeNull();
    expect(result!.descriptionOriginal).toBe("Consulting Services");
    expect(result!.description).toBe("");
  });

  it("leaves descriptionOriginal blank when no lineDescription in extractedFields", () => {
    const result = buildTextExtractionFallbackLine(
      0, null, null, null,
      { netAmount: "4500", vatAmount: "0", grossAmount: "4500" },
    );
    expect(result).not.toBeNull();
    expect(result!.descriptionOriginal).toBe("");
  });
});

// ── Table-header description heuristic ───────────────────────────────────────

describe("Description heuristic — table header multi-column", () => {
  it('extracts leading text "Test" from "Item Quantity Rate Amount" + "Test 1 200 200"', () => {
    const fields = parseInvoiceFields(
      "Invoice No: 1\nNet: 200\nVAT: 0\nTotal: 200\nItem Quantity Rate Amount\nTest 1 200 200",
    );
    expect(fields.lineDescription).toBe("Test");
  });

  it('extracts multi-word leading text from "Item Qty Amount" + "Consulting service 2 100 200"', () => {
    const fields = parseInvoiceFields(
      "Invoice No: 1\nNet: 200\nVAT: 0\nTotal: 200\nItem Qty Amount\nConsulting service 2 100 200",
    );
    expect(fields.lineDescription).toBe("Consulting service");
  });

  it('extracts leading text when header uses "Description" and "Price" columns', () => {
    const fields = parseInvoiceFields(
      "Subtotal: 500\nVAT: 0\nTotal: 500\nDescription Unit Price Amount\nAnnual support 1 500 500",
    );
    expect(fields.lineDescription).toBe("Annual support");
  });

  it("returns undefined when data row starts with a numeric token (no text prefix)", () => {
    const fields = parseInvoiceFields(
      "Net: 200\nVAT: 0\nTotal: 200\nItem Quantity Rate Amount\n1 200 200",
    );
    expect(fields.lineDescription).toBeUndefined();
  });

  it("returns undefined when table header has no recognised column keyword", () => {
    const fields = parseInvoiceFields(
      "Net: 200\nVAT: 0\nTotal: 200\nItem Code Reference\nTest 1 200",
    );
    // "Code" and "Reference" are not in the column keyword list
    expect(fields.lineDescription).toBeUndefined();
  });
});
