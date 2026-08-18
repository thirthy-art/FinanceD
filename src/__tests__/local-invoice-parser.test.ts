import { describe, expect, it } from "vitest";
import { parseInvoiceFields } from "../lib/extract";

const ACCEPTANCE_FIXTURE = `INVOICE
# 5
Test2
Bill To:
Testcomp
Aug 4, 2026
Aug 18, 2026
€550.00
Date:
Due Date:
Balance Due:
Item Quantity Rate Amount
Test 1 €200.00 €200.00
Test 1 €350.00 €350.00
€550.00
€0.00
€550.00
Subtotal:
Tax (0%):
Total:`;

describe("local invoice field parser", () => {
  it.each([
    ["Invoice # 123", "123"],
    ["Invoice No: ABC-123", "ABC-123"],
    ["Invoice Number INV/2026/01", "INV/2026/01"],
  ])("parses a same-line invoice number from %s", (text, expected) => {
    expect(parseInvoiceFields(text).invoiceNumber).toBe(expected);
  });

  it("parses the conservative split-line invoice header form", () => {
    expect(parseInvoiceFields("INVOICE\n# 5").invoiceNumber).toBe("5");
  });

  it.each([
    ["Date: 04/08/2026", "2026-08-04"],
    ["Invoice Date: 2026-08-04", "2026-08-04"],
    ["Date: Aug 4, 2026", "2026-08-04"],
    ["Date: 4 August 2026", "2026-08-04"],
  ])("normalizes a labelled date in %s", (text, expected) => {
    expect(parseInvoiceFields(text).invoiceDate).toBe(expected);
  });

  it("associates labelled invoice and due dates on nearby lines", () => {
    const fields = parseInvoiceFields("Invoice Date:\n4 August 2026\nPayment Due:\n18 August 2026");
    expect(fields.invoiceDate).toBe("2026-08-04");
    expect(fields.dueDate).toBe("2026-08-18");
  });

  it.each([
    ["Total: 20.00 EUR", "EUR"],
    ["Total: €20.00", "EUR"],
    ["Total: £20.00", "GBP"],
    ["Total: $20.00", "USD"],
  ])("parses currency from %s", (text, expected) => {
    expect(parseInvoiceFields(text).currency).toBe(expected);
  });

  it("prefers an explicit currency code over a conflicting symbol", () => {
    expect(parseInvoiceFields("Total: $20.00 EUR").currency).toBe("EUR");
  });

  it("parses same-line subtotal, zero tax, and total amounts", () => {
    const fields = parseInvoiceFields("Subtotal: 100.00\nVAT Amount: 0.00\nAmount Payable: 100.00");
    expect(fields.netAmount).toBe("100.00");
    expect(fields.vatAmount).toBe("0.00");
    expect(fields.grossAmount).toBe("100.00");
  });

  it("parses values on adjacent separate lines", () => {
    const fields = parseInvoiceFields("Net Amount:\n100.00\nGST:\n20.00\nGross Amount:\n120.00");
    expect(fields.netAmount).toBe("100.00");
    expect(fields.vatAmount).toBe("20.00");
    expect(fields.grossAmount).toBe("120.00");
  });

  it("pairs an unambiguous amount block with the following label block", () => {
    const fields = parseInvoiceFields("€550.00\n€0.00\n€550.00\nSubtotal:\nTax (0%):\nTotal:");
    expect(fields.netAmount).toBe("550.00");
    expect(fields.vatAmount).toBe("0.00");
    expect(fields.grossAmount).toBe("550.00");
  });

  it("parses the supplied embedded-text acceptance fixture", () => {
    const fields = parseInvoiceFields(ACCEPTANCE_FIXTURE);
    expect(fields).toMatchObject({
      invoiceNumber: "5",
      invoiceDate: "2026-08-04",
      dueDate: "2026-08-18",
      currency: "EUR",
      netAmount: "550.00",
      vatAmount: "0.00",
      grossAmount: "550.00",
    });
  });

  it("leaves ambiguous dates and conflicting currencies undefined", () => {
    const fields = parseInvoiceFields(
      "Date:\nDue Date:\n2026-08-04\n2026-08-18\n2026-09-01\nTotals shown in USD and EUR",
    );
    expect(fields.invoiceDate).toBeUndefined();
    expect(fields.dueDate).toBeUndefined();
    expect(fields.currency).toBeUndefined();
  });

  it("leaves missing fields undefined and does not infer an arbitrary invoice number", () => {
    const fields = parseInvoiceFields("INVOICE\nReference\n12345\nThanks");
    expect(fields.invoiceNumber).toBeUndefined();
    expect(fields.invoiceDate).toBeUndefined();
    expect(fields.grossAmount).toBeUndefined();
  });

  it("does not select line-item prices as invoice-level totals", () => {
    const fields = parseInvoiceFields(
      "Item Quantity Rate Amount\nConsulting 1 €200.00 €200.00\nSupport 1 €350.00 €350.00",
    );
    expect(fields.netAmount).toBeUndefined();
    expect(fields.vatAmount).toBeUndefined();
    expect(fields.grossAmount).toBeUndefined();
  });
});
