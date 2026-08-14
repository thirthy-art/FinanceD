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
  it("returns empty object for empty string", () => {
    expect(parseInvoiceFields("")).toEqual({});
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

  it("extracts net amount as decimal string", () => {
    const fields = parseInvoiceFields(SAMPLE_INVOICE_TEXT);
    expect(fields.netAmount).toBe("1000.00");
    expect(typeof fields.netAmount).toBe("string");
  });

  it("extracts VAT amount as decimal string", () => {
    const fields = parseInvoiceFields(SAMPLE_INVOICE_TEXT);
    expect(fields.vatAmount).toBe("200.00");
    expect(typeof fields.vatAmount).toBe("string");
  });

  it("extracts gross amount as decimal string", () => {
    const fields = parseInvoiceFields(SAMPLE_INVOICE_TEXT);
    expect(fields.grossAmount).toBe("1200.00");
    expect(typeof fields.grossAmount).toBe("string");
  });

  it("handles ISO date format", () => {
    const text = "Supplier Inc\nInvoice No: S-001\nDate: 2024-03-20\nTotal: 500.00";
    const fields = parseInvoiceFields(text);
    expect(fields.invoiceDate).toBe("2024-03-20");
  });

  it("does not crash on garbage text", () => {
    expect(() => parseInvoiceFields("!@#$%^&*()")).not.toThrow();
  });

  it("returns only detected fields, not fabricated data", () => {
    const fields = parseInvoiceFields("Random line\nAnother line");
    expect(fields.netAmount).toBeUndefined();
    expect(fields.vatAmount).toBeUndefined();
    expect(fields.grossAmount).toBeUndefined();
  });

  it("all returned amount values are strings, never numbers", () => {
    const fields = parseInvoiceFields(SAMPLE_INVOICE_TEXT);
    for (const [key, v] of Object.entries(fields)) {
      expect(typeof v).toBe("string");
      if (key.includes("Amount")) {
        // Amount strings should be valid decimal representations
        expect(v).toMatch(/^\d+\.?\d*$/);
      }
    }
  });
});

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
