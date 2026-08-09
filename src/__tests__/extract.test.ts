import { describe, it, expect } from "vitest";
import { parseInvoiceFields } from "../lib/extract";

const SAMPLE_INVOICE_TEXT = `ACME Corp Ltd
Invoice Number: INV-2024-0042
Invoice Date: 15/01/2024
Due Date: 14/02/2024
Net Amount: 1000.00 USD
VAT Amount: 200.00 USD
Total: 1200.00 USD`;

describe("parseInvoiceFields", () => {
  it("returns empty object for empty string (extraction failure path)", () => {
    const fields = parseInvoiceFields("");
    expect(fields).toEqual({});
  });

  it("returns empty object for whitespace-only string", () => {
    expect(parseInvoiceFields("   \n  ")).toEqual({});
  });

  it("extracts vendor name from first substantive line", () => {
    const fields = parseInvoiceFields(SAMPLE_INVOICE_TEXT);
    expect(fields.vendorName).toBe("ACME Corp Ltd");
  });

  it("extracts invoice number", () => {
    const fields = parseInvoiceFields(SAMPLE_INVOICE_TEXT);
    expect(fields.invoiceNumber).toBe("INV-2024-0042");
  });

  it("normalises invoice date to ISO format", () => {
    const fields = parseInvoiceFields(SAMPLE_INVOICE_TEXT);
    expect(fields.invoiceDate).toBe("2024-01-15");
  });

  it("extracts due date as second date found", () => {
    const fields = parseInvoiceFields(SAMPLE_INVOICE_TEXT);
    expect(fields.dueDate).toBe("2024-02-14");
  });

  it("extracts currency code", () => {
    const fields = parseInvoiceFields(SAMPLE_INVOICE_TEXT);
    expect(fields.currency).toBe("USD");
  });

  it("extracts net amount", () => {
    const fields = parseInvoiceFields(SAMPLE_INVOICE_TEXT);
    expect(fields.netAmount).toBe("1000.00");
  });

  it("extracts VAT amount", () => {
    const fields = parseInvoiceFields(SAMPLE_INVOICE_TEXT);
    expect(fields.vatAmount).toBe("200.00");
  });

  it("extracts gross amount from 'Total' line", () => {
    const fields = parseInvoiceFields(SAMPLE_INVOICE_TEXT);
    expect(fields.grossAmount).toBe("1200.00");
  });

  it("handles ISO date format in invoice date", () => {
    const text = "Supplier Inc\nInvoice No: S-001\nDate: 2024-03-20\nTotal: 500.00";
    const fields = parseInvoiceFields(text);
    expect(fields.invoiceDate).toBe("2024-03-20");
  });

  it("does not crash on garbage text", () => {
    expect(() => parseInvoiceFields("!@#$%^&*()")).not.toThrow();
  });

  it("returns only the fields it can detect, not invented data", () => {
    const fields = parseInvoiceFields("Random line\nAnother line");
    // Should not fabricate amounts
    expect(fields.netAmount).toBeUndefined();
    expect(fields.vatAmount).toBeUndefined();
    expect(fields.grossAmount).toBeUndefined();
  });
});

// ── Extraction failure → manual entry is still possible ────────────────────────
//
// When extraction returns empty text (scanned PDF, corrupt file, OCR failure),
// the upload route returns `fields: {}` and the UI pre-fills nothing.
// The user can enter every field manually. This test verifies that the
// parseInvoiceFields function does not throw or return invalid data for the
// empty-text case — the behaviour contract the upload route relies on.

describe("extraction failure contract", () => {
  it("empty extracted text produces empty fields without error", () => {
    const fields = parseInvoiceFields("");
    expect(typeof fields).toBe("object");
    expect(Object.keys(fields)).toHaveLength(0);
  });

  it("all returned field values are strings when present", () => {
    const fields = parseInvoiceFields(SAMPLE_INVOICE_TEXT);
    for (const v of Object.values(fields)) {
      expect(typeof v).toBe("string");
    }
  });
});
