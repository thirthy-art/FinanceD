import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  parsePageInput,
  isCompletelyEmptyLine,
  editableLineToInput,
  emptyEditableInvoiceLine,
} from "@/src/lib/invoice-lines";
import { amountsWithinTolerance } from "@/src/lib/invoice-validation";
import InvoiceLinesEditor from "@/src/components/InvoiceLinesEditor";

// ── parsePageInput (fix H) ───────────────────────────────────────────────────

describe("parsePageInput", () => {
  it("returns null for blank input", () => {
    expect(parsePageInput("")).toEqual({ value: null, error: null });
    expect(parsePageInput("  ")).toEqual({ value: null, error: null });
  });

  it("returns value for valid positive integers", () => {
    expect(parsePageInput("1")).toEqual({ value: 1, error: null });
    expect(parsePageInput("42")).toEqual({ value: 42, error: null });
    expect(parsePageInput(" 5 ")).toEqual({ value: 5, error: null });
  });

  it("returns error for zero", () => {
    expect(parsePageInput("0").error).toBeTruthy();
  });

  it("returns error for negative integers", () => {
    expect(parsePageInput("-1").error).toBeTruthy();
  });

  it("returns error for decimal values", () => {
    expect(parsePageInput("1.5").error).toBeTruthy();
  });

  it("returns error for non-numeric strings", () => {
    expect(parsePageInput("abc").error).toBeTruthy();
  });
});

// ── isCompletelyEmptyLine (fix I) ─────────────────────────────────────────────

describe("isCompletelyEmptyLine", () => {
  it("returns true for a default empty line (Immediate treatment)", () => {
    expect(isCompletelyEmptyLine(emptyEditableInvoiceLine())).toBe(true);
  });

  it("returns false when description is filled", () => {
    expect(isCompletelyEmptyLine({ ...emptyEditableInvoiceLine(), description: "service fee" })).toBe(false);
  });

  it("returns false when a numeric field is filled", () => {
    expect(isCompletelyEmptyLine({ ...emptyEditableInvoiceLine(), netAmount: "100" })).toBe(false);
    expect(isCompletelyEmptyLine({ ...emptyEditableInvoiceLine(), quantity: "1" })).toBe(false);
  });

  it("returns false when sourcePage is filled", () => {
    expect(isCompletelyEmptyLine({ ...emptyEditableInvoiceLine(), sourcePage: "1" })).toBe(false);
  });

  it("returns false when recognitionTreatment is Prepaid even with all other fields blank", () => {
    const line = { ...emptyEditableInvoiceLine(), recognitionTreatment: "Prepaid" as const };
    expect(isCompletelyEmptyLine(line)).toBe(false);
  });

  it("returns false when only accountingAccountNumber is set", () => {
    expect(isCompletelyEmptyLine({ ...emptyEditableInvoiceLine(), accountingAccountNumber: "6000" })).toBe(false);
  });
});

// ── editableLineToInput derived flags (fix A) ─────────────────────────────────

describe("editableLineToInput — derived flags", () => {
  it("sets netAmountDerived=true when net is blank but qty×price can be computed", () => {
    const line = { ...emptyEditableInvoiceLine(), quantity: "5", unitPrice: "20" };
    const result = editableLineToInput(line);
    expect(result.netAmountDerived).toBe(true);
    expect(result.netAmount).toBe("100");
  });

  it("sets netAmountDerived=false when net is explicitly provided", () => {
    const line = { ...emptyEditableInvoiceLine(), netAmount: "100", quantity: "5", unitPrice: "20" };
    const result = editableLineToInput(line);
    expect(result.netAmountDerived).toBe(false);
    expect(result.netAmount).toBe("100");
  });

  it("sets vatAmountDerived=true when vat is blank and can be computed from net×rate", () => {
    const line = { ...emptyEditableInvoiceLine(), netAmount: "100", vatRate: "19" };
    const result = editableLineToInput(line);
    expect(result.vatAmountDerived).toBe(true);
    expect(result.vatAmount).toBe("19");
  });

  it("sets grossAmountDerived=true when gross is blank and net+vat are both available", () => {
    const line = { ...emptyEditableInvoiceLine(), netAmount: "100", vatAmount: "19" };
    const result = editableLineToInput(line);
    expect(result.grossAmountDerived).toBe(true);
    expect(result.grossAmount).toBe("119");
  });

  it("all flags are false when all three amounts are explicitly provided", () => {
    const line = { ...emptyEditableInvoiceLine(), netAmount: "100", vatAmount: "19", grossAmount: "119" };
    const result = editableLineToInput(line);
    expect(result.netAmountDerived).toBe(false);
    expect(result.vatAmountDerived).toBe(false);
    expect(result.grossAmountDerived).toBe(false);
  });

  it("netAmountDerived=false when auto-calc cannot compute (missing qty or unitPrice)", () => {
    const line = { ...emptyEditableInvoiceLine(), quantity: "5" };
    const result = editableLineToInput(line);
    expect(result.netAmountDerived).toBe(false);
    expect(result.netAmount).toBeNull();
  });

  it("throws on invalid page input", () => {
    const line = { ...emptyEditableInvoiceLine(), sourcePage: "abc" };
    expect(() => editableLineToInput(line)).toThrow();
  });
});

// ── amountsWithinTolerance (fix B / fix C) ────────────────────────────────────

describe("amountsWithinTolerance", () => {
  it("fiat: amounts equal are within tolerance", () => {
    expect(amountsWithinTolerance("100", "100", "fiat")).toBe(true);
  });

  it("fiat: difference of exactly 0.01 is within tolerance", () => {
    expect(amountsWithinTolerance("100", "100.01", "fiat")).toBe(true);
    expect(amountsWithinTolerance("100.01", "100", "fiat")).toBe(true);
  });

  it("fiat: difference of 0.02 exceeds tolerance", () => {
    expect(amountsWithinTolerance("100", "100.02", "fiat")).toBe(false);
  });

  it("fiat: larger mismatch is flagged", () => {
    expect(amountsWithinTolerance("100", "101", "fiat")).toBe(false);
  });

  it("crypto: exact match passes", () => {
    expect(amountsWithinTolerance("1.000000000000000001", "1.000000000000000001", "crypto")).toBe(true);
  });

  it("crypto: any nonzero difference fails", () => {
    expect(amountsWithinTolerance("1.000000000000000001", "1.000000000000000002", "crypto")).toBe(false);
  });

  it("treats null and blank as zero", () => {
    expect(amountsWithinTolerance(null, null, "fiat")).toBe(true);
    expect(amountsWithinTolerance("0", null, "fiat")).toBe(true);
    expect(amountsWithinTolerance("1", null, "fiat")).toBe(false);
  });
});

// ── Account labels (fix E) ────────────────────────────────────────────────────

describe("InvoiceLinesEditor account labels", () => {
  it("renders 'Expense account' for the accounting account field", () => {
    const html = renderToStaticMarkup(
      <InvoiceLinesEditor
        lines={[emptyEditableInvoiceLine()]}
        postingAccounts={[{ code: "6000", name: "Services" }]}
        invoiceNetAmount="0"
        onChange={() => undefined}
      />,
    );
    expect(html).toContain("Expense account");
    expect(html).not.toContain("Accounting account no.");
  });

  it("renders 'Prepaid asset account' without '(optional)' for Prepaid lines", () => {
    const html = renderToStaticMarkup(
      <InvoiceLinesEditor
        lines={[{ ...emptyEditableInvoiceLine(), recognitionTreatment: "Prepaid" }]}
        postingAccounts={[]}
        prepaidAccounts={[{ code: "1700", name: "Prepaid Expenses" }]}
        invoiceNetAmount="0"
        onChange={() => undefined}
      />,
    );
    expect(html).toContain("Prepaid asset account");
    expect(html).not.toContain("Prepaid asset account (optional)");
  });
});

// ── Mismatch tolerance in line display (fix C) ───────────────────────────────

describe("InvoiceLinesEditor mismatch tolerance", () => {
  it("does NOT warn for fiat amounts within 0.01 tolerance", () => {
    const line = { ...emptyEditableInvoiceLine(), netAmount: "100", vatAmount: "19", grossAmount: "119.01" };
    const html = renderToStaticMarkup(
      <InvoiceLinesEditor
        lines={[line]}
        postingAccounts={[]}
        invoiceNetAmount="0"
        currencyType="fiat"
        onChange={() => undefined}
      />,
    );
    expect(html).not.toContain("Net + VAT Amount does not match Gross Amount");
  });

  it("warns for fiat amounts exceeding 0.01 tolerance", () => {
    const line = { ...emptyEditableInvoiceLine(), netAmount: "100", vatAmount: "19", grossAmount: "120" };
    const html = renderToStaticMarkup(
      <InvoiceLinesEditor
        lines={[line]}
        postingAccounts={[]}
        invoiceNetAmount="0"
        currencyType="fiat"
        onChange={() => undefined}
      />,
    );
    expect(html).toContain("Net + VAT Amount does not match Gross Amount");
  });

  it("warns for crypto amounts with any nonzero difference", () => {
    const line = {
      ...emptyEditableInvoiceLine(),
      netAmount: "1.00000000",
      vatAmount: "0",
      grossAmount: "1.00000001",
    };
    const html = renderToStaticMarkup(
      <InvoiceLinesEditor
        lines={[line]}
        postingAccounts={[]}
        invoiceNetAmount="0"
        currencyType="crypto"
        onChange={() => undefined}
      />,
    );
    expect(html).toContain("Net + VAT Amount does not match Gross Amount");
  });
});

// ── RecognitionPreview FX suppression (fix K) ────────────────────────────────

describe("RecognitionPreview FX suppression", () => {
  const prepaidLine = {
    ...emptyEditableInvoiceLine(),
    recognitionTreatment: "Prepaid" as const,
    netAmount: "100",
    recognitionStartDate: "2026-01-01",
    recognitionEndDate: "2026-03-31",
  };

  it("shows base column when foreign currency and valid FX rate are both provided", () => {
    const html = renderToStaticMarkup(
      <InvoiceLinesEditor
        lines={[prepaidLine]}
        postingAccounts={[]}
        invoiceNetAmount="100"
        invoiceFxRate="1.08"
        invoiceCurrency="USD"
        baseCurrency="EUR"
        onChange={() => undefined}
      />,
    );
    expect(html).not.toContain("Enter a valid FX rate");
    expect(html).toContain("EUR");
  });

  it("shows FX note instead of fabricated base amounts when FX is absent for foreign currency", () => {
    const html = renderToStaticMarkup(
      <InvoiceLinesEditor
        lines={[prepaidLine]}
        postingAccounts={[]}
        invoiceNetAmount="100"
        invoiceFxRate={undefined}
        invoiceCurrency="USD"
        baseCurrency="EUR"
        onChange={() => undefined}
      />,
    );
    expect(html).toContain("Enter a valid FX rate");
  });

  it("shows FX note when FX rate string is empty", () => {
    const html = renderToStaticMarkup(
      <InvoiceLinesEditor
        lines={[prepaidLine]}
        postingAccounts={[]}
        invoiceNetAmount="100"
        invoiceFxRate=""
        invoiceCurrency="USD"
        baseCurrency="EUR"
        onChange={() => undefined}
      />,
    );
    expect(html).toContain("Enter a valid FX rate");
  });
});
