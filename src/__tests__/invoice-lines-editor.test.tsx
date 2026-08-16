import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import InvoiceLinesEditor from "@/src/components/InvoiceLinesEditor";
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

    expect(css).toMatch(/@media \(max-width: 767px\)[\s\S]*\.invoice-line-core-grid\s*{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
    expect(css).toMatch(/\.invoice-line-description-field\s*{\s*grid-column: 1 \/ -1;/);
    expect(css).toMatch(/\.invoice-line-account-field\s*{[\s\S]*width: 100%;[\s\S]*max-width: none;/);
    expect(css).toMatch(/\.invoice-line-control\s*{[\s\S]*min-height: 40px;[\s\S]*font-size: 16px !important;/);
  });
});
