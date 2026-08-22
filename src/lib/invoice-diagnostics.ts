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
  // Presence flags only — raw error text may embed user-entered values and
  // must never reach the diagnostics payload.
  saveError: boolean;
  extractionError: boolean;
  monetaryValidationErrorFields: string[];
  headerArithmeticMismatch: boolean;
  lineTotalsCheck: LineTotalsCheckResult;
}

// Reduces existing validation messages ("Net: Invalid decimal value: ...")
// to the field labels they belong to, dropping the raw parser text.
export function extractValidationErrorFields(errors: string[]): string[] {
  return errors
    .map((message) => message.split(":")[0].trim())
    .filter((field) => field !== "");
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
    `Save error: ${input.saveError ? "present" : "none"}`,
    `Extraction error: ${input.extractionError ? "present" : "none"}`,
    `Monetary validation errors: ${input.monetaryValidationErrorFields.length > 0 ? input.monetaryValidationErrorFields.join(", ") : "none"}`,
    `Header arithmetic mismatch: ${input.headerArithmeticMismatch ? "yes" : "no"}`,
    `Invoice-line net mismatch: ${lineState("net-mismatch")}`,
    `Invoice-line VAT mismatch: ${lineState("vat-mismatch")}`,
    `Invoice-line gross mismatch: ${lineState("gross-mismatch")}`,
  ].join("\n");
}
