// Builds a plain-text developer diagnostics snapshot for the invoice review page.
// The input type lists every field that may be copied — nothing else (no vendor,
// invoice number, dates, amounts, FX rate, notes, filenames, or extracted content)
// is accepted here by design.

export type LineTotalsCheckResult =
  | "ok"
  | "net-mismatch"
  | "vat-mismatch"
  | "gross-mismatch"
  | "not-checked";

export interface InvoiceDiagnosticsInput {
  pathname: string;
  invoiceId: number;
  invoiceStatus: "draft" | "approved";
  paymentStatus: "Paid" | "Unpaid";
  documentCount: number;
  editableLineCount: number;
  locale: string;
  viewportWidth: number;
  viewportHeight: number;
  userAgent: string;
  saveError: string | null;
  extractionError: string | null;
  monetaryValidationErrors: string[];
  headerArithmeticMismatch: boolean;
  lineTotalsCheck: LineTotalsCheckResult;
}

function orNone(value: string | null): string {
  return value && value.trim() !== "" ? value : "none";
}

export function buildInvoiceDiagnosticsText(input: InvoiceDiagnosticsInput): string {
  // checkLineTotalsForApproval stops at the first failing kind, so after a
  // mismatch the remaining kinds were never evaluated — report them honestly.
  function lineState(kind: "net-mismatch" | "vat-mismatch" | "gross-mismatch"): string {
    if (input.lineTotalsCheck === "not-checked") return "not-checked";
    if (input.lineTotalsCheck === "ok") return "no";
    return input.lineTotalsCheck === kind ? "yes" : "not-checked";
  }

  return [
    "Product: FinanceD",
    `Timestamp (UTC): ${new Date().toISOString()}`,
    `Route: ${input.pathname}`,
    `Invoice ID: ${input.invoiceId}`,
    `Invoice status: ${input.invoiceStatus}`,
    `Payment status: ${input.paymentStatus}`,
    `Documents: ${input.documentCount}`,
    `Editable invoice lines: ${input.editableLineCount}`,
    `Locale: ${input.locale}`,
    `Viewport: ${input.viewportWidth}x${input.viewportHeight}`,
    `User agent: ${input.userAgent}`,
    `Save error: ${orNone(input.saveError)}`,
    `Extraction error: ${orNone(input.extractionError)}`,
    `Monetary validation errors: ${input.monetaryValidationErrors.length > 0 ? input.monetaryValidationErrors.join("; ") : "none"}`,
    `Header arithmetic mismatch: ${input.headerArithmeticMismatch ? "yes" : "no"}`,
    `Invoice-line net mismatch: ${lineState("net-mismatch")}`,
    `Invoice-line VAT mismatch: ${lineState("vat-mismatch")}`,
    `Invoice-line gross mismatch: ${lineState("gross-mismatch")}`,
  ].join("\n");
}
