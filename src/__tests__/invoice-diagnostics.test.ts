import { describe, expect, it } from "vitest";
import { buildInvoiceDiagnosticsText, extractValidationErrorFields, type InvoiceDiagnosticsInput } from "@/src/lib/invoice-diagnostics";

function baseInput(overrides: Partial<InvoiceDiagnosticsInput> = {}): InvoiceDiagnosticsInput {
  return {
    pathname: "/invoices/42",
    invoiceId: 42,
    invoiceStatus: "draft",
    paymentStatus: "Unpaid",
    documentCount: 1,
    editableLineCount: 3,
    locale: "en",
    viewportWidth: 1440,
    viewportHeight: 900,
    userAgent: "TestBrowser/1.0",
    saveError: false,
    extractionError: false,
    monetaryValidationErrorFields: [],
    headerArithmeticMismatch: false,
    lineTotalsCheck: "ok",
    ...overrides,
  };
}

describe("buildInvoiceDiagnosticsText", () => {
  it("includes the allowed technical fields", () => {
    const text = buildInvoiceDiagnosticsText(baseInput());
    expect(text).toContain("Product: FinanceD");
    expect(text).toMatch(/Timestamp \(UTC\): \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
    expect(text).toContain("Route: /invoices/42");
    expect(text).toContain("Invoice ID: 42");
    expect(text).toContain("Invoice status: draft");
    expect(text).toContain("Payment status: Unpaid");
    expect(text).toContain("Documents: 1");
    expect(text).toContain("Editable invoice lines: 3");
    expect(text).toContain("Locale: en");
    expect(text).toContain("Viewport: 1440x900");
    expect(text).toContain("User agent: TestBrowser/1.0");
  });

  it("reports 'none' for absent error state and 'no' for clean checks", () => {
    const text = buildInvoiceDiagnosticsText(baseInput());
    expect(text).toContain("Save error: none");
    expect(text).toContain("Extraction error: none");
    expect(text).toContain("Monetary validation errors: none");
    expect(text).toContain("Header arithmetic mismatch: no");
    expect(text).toContain("Invoice-line net mismatch: no");
    expect(text).toContain("Invoice-line VAT mismatch: no");
    expect(text).toContain("Invoice-line gross mismatch: no");
  });

  it("surfaces current error and mismatch state without raw error text", () => {
    const text = buildInvoiceDiagnosticsText(baseInput({
      invoiceStatus: "approved",
      paymentStatus: "Paid",
      saveError: true,
      extractionError: true,
      monetaryValidationErrorFields: ["Net", "FX Rate"],
      headerArithmeticMismatch: true,
      lineTotalsCheck: "vat-mismatch",
    }));
    expect(text).toContain("Invoice status: approved");
    expect(text).toContain("Payment status: Paid");
    expect(text).toContain("Save error: present");
    expect(text).toContain("Extraction error: present");
    expect(text).toContain("Monetary validation errors: Net, FX Rate");
    expect(text).toContain("Header arithmetic mismatch: yes");
    expect(text).toContain("Invoice-line net mismatch: not-checked");
    expect(text).toContain("Invoice-line VAT mismatch: yes");
    expect(text).toContain("Invoice-line gross mismatch: not-checked");
  });

  it("marks line checks as not-checked when the totals check did not run", () => {
    const text = buildInvoiceDiagnosticsText(baseInput({ lineTotalsCheck: "not-checked" }));
    expect(text).toContain("Invoice-line net mismatch: not-checked");
    expect(text).toContain("Invoice-line VAT mismatch: not-checked");
    expect(text).toContain("Invoice-line gross mismatch: not-checked");
  });

  it("never leaks sensitive values embedded in raw error messages", () => {
    const sensitiveValues = [
      "1234.56", // user-entered amount echoed by the decimal parser
      "INV-2026-001", // invoice number
      "Acme Supplier", // vendor name
      "Tax-998877", // vendor tax ID
      "2026-01-15", // invoice date
      "0.9234", // FX rate
      "Consulting services", // line description
      "invoice-scan.pdf", // document filename
      "uploads/", // storage path
    ];

    // Raw UI error state containing sensitive values — the shape of what the
    // review page actually holds when validation/save/extraction fail.
    const rawSaveError: string = "Save failed for INV-2026-001 (Acme Supplier, 1234.56)";
    const rawExtractionError: string = "Extraction failed on invoice-scan.pdf from uploads/ dated 2026-01-15";
    const rawValidationErrors = [
      `Net: Invalid decimal value: "1234.56"`,
      `Gross: Ambiguous value: "1,234.56" — clarify for Acme Supplier (Tax-998877)`,
      `FX Rate: Invalid decimal value: "0.9234" near Consulting services`,
    ];

    // Mirror the component-side derivation exactly.
    const text = buildInvoiceDiagnosticsText(baseInput({
      saveError: rawSaveError !== "",
      extractionError: rawExtractionError !== "",
      monetaryValidationErrorFields: extractValidationErrorFields(rawValidationErrors),
    }));

    expect(text).toContain("Save error: present");
    expect(text).toContain("Extraction error: present");
    expect(text).toContain("Monetary validation errors: Net, Gross, FX Rate");
    for (const value of sensitiveValues) {
      expect(text).not.toContain(value);
    }
    expect(text).not.toMatch(/Invalid decimal value|Ambiguous value|Save failed|Extraction failed/);
  });

  it("contains no sensitive invoice, vendor, or financial values", () => {
    const text = buildInvoiceDiagnosticsText(baseInput());
    const sensitiveValues = [
      "Acme", // vendor name
      "Tax-998877", // vendor tax ID
      "INV-2026-001", // invoice number
      "2026-01-15", // invoice date / due date
      "1234.56", // net / VAT / gross amounts
      "0.9234", // FX rate
      "0.02", // adjustment value
      "Consulting services", // line description
      "6010", // accounting account number
      "CC-MARKETING", // cost centre
      "Urgent supplier note", // notes
      "invoice-scan.pdf", // document filename
      "extracted OCR text",
      "sk-", // API key fragment
      "DATABASE_URL", // environment variable
      "uploads/", // storage path
    ];
    for (const value of sensitiveValues) {
      expect(text).not.toContain(value);
    }
    expect(text).not.toMatch(/Net amount|VAT amount|Gross amount|FX rate/i);
  });
});
