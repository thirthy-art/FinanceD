import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import InvoiceLinesEditor from "@/src/components/InvoiceLinesEditor";

vi.mock("@/src/i18n/context", async () => {
  const { getMessages } = await import("@/src/i18n/index");
  return {
    useI18n: () => ({
      locale: "en" as const,
      t: getMessages("en"),
      setLocale: () => undefined,
    }),
  };
});
import { emptyEditableInvoiceLine } from "@/src/lib/invoice-lines";

describe("InvoiceLinesEditor", () => {
  it("renders posting-account labels while persisting account numbers as option values", () => {
    const html = renderToStaticMarkup(
      <InvoiceLinesEditor
        lines={[{ ...emptyEditableInvoiceLine(), accountingAccountNumber: "743080" }]}
        postingAccounts={[
          { code: "743080", name: "Cleaning Expenses" },
          { code: "743140", name: "Cleaning Supplies" },
        ]}
        invoiceNetAmount="0"
        onChange={() => undefined}
      />,
    );

    expect(html).toContain('<option value="">-- none --</option>');
    expect(html).toContain('<option value="743080" selected="">743080 — Cleaning Expenses</option>');
    expect(html).toContain('<option value="743140">743140 — Cleaning Supplies</option>');
  });

  it("has a narrow-screen grid with full-width descriptions and account selection", () => {
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

    expect(css).toMatch(/@media \(max-width: 767px\)[\s\S]*\.invoice-line-core-grid\s*{[\s\S]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
    expect(css).toMatch(/\.invoice-line-original-description-field\s*{\s*grid-column: 1 \/ -1;/);
    expect(css).toMatch(/\.invoice-line-account-field\s*{[\s\S]*width: 100%;[\s\S]*max-width: none;/);
    expect(css).toMatch(/\.invoice-line-control\s*{[\s\S]*min-height: 40px;[\s\S]*font-size: 16px !important;/);
  });

  it("renders 'VAT rate (%)', 'Unit of measure', and 'Gross amount' labels", () => {
    const html = renderToStaticMarkup(
      <InvoiceLinesEditor
        lines={[emptyEditableInvoiceLine()]}
        postingAccounts={[]}
        invoiceNetAmount="0"
        onChange={() => undefined}
      />,
    );

    expect(html).toContain("VAT rate (%)");
    expect(html).toContain("Unit of measure");
    expect(html).toContain("Gross amount");
  });

  it("shows derived net amount in blue when qty and unit price are set but net is blank", () => {
    const line = { ...emptyEditableInvoiceLine(), quantity: "3", unitPrice: "10", netAmount: "" };
    const html = renderToStaticMarkup(
      <InvoiceLinesEditor
        lines={[line]}
        postingAccounts={[]}
        invoiceNetAmount="0"
        onChange={() => undefined}
      />,
    );
    // Derived field uses blue border color from derivedStyle
    expect(html).toContain("#93c5fd");
    // The derived value 30 should appear as the input value
    expect(html).toContain('value="30"');
  });

  it("shows gross mismatch warning when net+vat does not equal explicit gross", () => {
    const line = { ...emptyEditableInvoiceLine(), netAmount: "100", vatAmount: "19", grossAmount: "120" };
    const html = renderToStaticMarkup(
      <InvoiceLinesEditor
        lines={[line]}
        postingAccounts={[]}
        invoiceNetAmount="0"
        onChange={() => undefined}
      />,
    );
    expect(html).toContain("Net + VAT Amount does not match Gross Amount");
  });

  it("shows prepaid account selector for Prepaid lines but not for Immediate lines", () => {
    const prepaidLine = { ...emptyEditableInvoiceLine(), recognitionTreatment: "Prepaid" as const };
    const immediateLine = { ...emptyEditableInvoiceLine(), recognitionTreatment: "Immediate" as const };

    const prepaidHtml = renderToStaticMarkup(
      <InvoiceLinesEditor
        lines={[prepaidLine]}
        postingAccounts={[]}
        prepaidAccounts={[{ code: "1700", name: "Prepaid Expenses" }]}
        invoiceNetAmount="0"
        onChange={() => undefined}
      />,
    );
    expect(prepaidHtml).toContain("Prepaid asset account");
    expect(prepaidHtml).toContain("1700");

    const immediateHtml = renderToStaticMarkup(
      <InvoiceLinesEditor
        lines={[immediateLine]}
        postingAccounts={[]}
        prepaidAccounts={[{ code: "1700", name: "Prepaid Expenses" }]}
        invoiceNetAmount="0"
        onChange={() => undefined}
      />,
    );
    expect(immediateHtml).not.toContain("Prepaid asset account");
  });

  it("does not throw when RecognitionPreview receives an invalid netAmount", () => {
    const line = {
      ...emptyEditableInvoiceLine(),
      recognitionTreatment: "Prepaid" as const,
      netAmount: "not-a-number",
      recognitionStartDate: "2026-01-01",
      recognitionEndDate: "2026-03-31",
    };
    expect(() =>
      renderToStaticMarkup(
        <InvoiceLinesEditor
          lines={[line]}
          postingAccounts={[]}
          invoiceNetAmount="0"
          onChange={() => undefined}
        />,
      )
    ).not.toThrow();
  });

  it("stacks date fields vertically on narrow screens", () => {
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
    expect(css).toMatch(/@media \(max-width: 767px\)[\s\S]*\.invoice-line-date-field\s*\{[\s\S]*flex:\s*1 1 100%/);
  });
});
