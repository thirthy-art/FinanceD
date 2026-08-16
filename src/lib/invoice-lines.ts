import { z } from "zod";
import { parseDecimalInput, safeParseDecimal, toDecimal } from "./invoice-validation";
import { Decimal } from "./decimal";

const nullableText = (max: number) => z.string().max(max).nullable();
const nullableDecimalInput = z.string().max(100).nullable();

export const InvoiceLineInputSchema = z.object({
  lineNumber: nullableText(100),
  descriptionOriginal: nullableText(10_000),
  description: nullableText(10_000),
  quantity: nullableDecimalInput,
  unit: nullableText(100),
  unitPrice: nullableDecimalInput,
  netAmount: nullableDecimalInput,
  vatRate: nullableDecimalInput,
  vatAmount: nullableDecimalInput,
  grossAmount: nullableDecimalInput,
  sourcePage: z.number().int().positive().nullable(),
  recognitionTreatment: z.enum(["Immediate", "Prepaid"]).default("Immediate"),
  recognitionStartDate: nullableText(10),
  recognitionEndDate: nullableText(10),
  accountingAccountNumber: nullableText(50),
  prepaidAccountNumber: nullableText(50),
  netAmountDerived: z.boolean().default(false),
  vatAmountDerived: z.boolean().default(false),
  grossAmountDerived: z.boolean().default(false),
});

export type InvoiceLineInput = z.infer<typeof InvoiceLineInputSchema>;

export interface EditableInvoiceLine {
  id?: number;
  lineNumber: string;
  descriptionOriginal: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  netAmount: string;
  vatRate: string;
  vatAmount: string;
  grossAmount: string;
  sourcePage: string;
  recognitionTreatment: "Immediate" | "Prepaid";
  recognitionStartDate: string;
  recognitionEndDate: string;
  accountingAccountNumber: string;
  prepaidAccountNumber: string;
}

const DECIMAL_FIELDS = [
  "quantity",
  "unitPrice",
  "netAmount",
  "vatRate",
  "vatAmount",
  "grossAmount",
] as const;

export function normalizeInvoiceLineInput(line: InvoiceLineInput, index: number): InvoiceLineInput {
  const normalized = { ...line };
  for (const field of DECIMAL_FIELDS) {
    if (line[field] === null) continue;
    const value = parseDecimalInput(line[field]);
    if (value === null) {
      normalized[field] = null;
      continue;
    }
    const [integerPart, fractionalPart = ""] = value.replace("-", "").split(".");
    const integerDigits = integerPart.replace(/^0+/, "").length || 1;
    if (integerDigits > 20 || fractionalPart.length > 18) {
      throw new Error(`Line ${index + 1} ${field} exceeds the supported decimal precision.`);
    }
    normalized[field] = value;
  }
  normalized.recognitionTreatment = line.recognitionTreatment ?? "Immediate";
  normalized.recognitionStartDate = line.recognitionStartDate ?? null;
  normalized.recognitionEndDate = line.recognitionEndDate ?? null;
  normalized.accountingAccountNumber = line.accountingAccountNumber ?? null;
  normalized.prepaidAccountNumber = line.prepaidAccountNumber ?? null;
  normalized.netAmountDerived = line.netAmountDerived ?? false;
  normalized.vatAmountDerived = line.vatAmountDerived ?? false;
  normalized.grossAmountDerived = line.grossAmountDerived ?? false;
  return normalized;
}

export function emptyEditableInvoiceLine(): EditableInvoiceLine {
  return {
    lineNumber: "",
    descriptionOriginal: "",
    description: "",
    quantity: "",
    unit: "",
    unitPrice: "",
    netAmount: "",
    vatRate: "",
    vatAmount: "",
    grossAmount: "",
    sourcePage: "",
    recognitionTreatment: "Immediate",
    recognitionStartDate: "",
    recognitionEndDate: "",
    accountingAccountNumber: "",
    prepaidAccountNumber: "",
  };
}

/**
 * Returns { value, error } for a sourcePage string.
 * Blank input → { value: null, error: null }.
 * Non-positive-integer input → { value: null, error: <message> }.
 */
export function parsePageInput(raw: string): { value: number | null; error: string | null } {
  const trimmed = raw.trim();
  if (!trimmed) return { value: null, error: null };
  const num = Number(trimmed);
  if (!Number.isInteger(num) || num <= 0 || !Number.isFinite(num)) {
    return { value: null, error: "Page must be a positive whole number" };
  }
  return { value: num, error: null };
}

/**
 * Returns true when an EditableInvoiceLine has no meaningful user content.
 * recognitionTreatment = "Immediate" alone is not meaningful; "Prepaid" is.
 */
export function isCompletelyEmptyLine(line: EditableInvoiceLine): boolean {
  return (
    !line.lineNumber.trim() &&
    !line.descriptionOriginal.trim() &&
    !line.description.trim() &&
    !line.quantity.trim() &&
    !line.unit.trim() &&
    !line.unitPrice.trim() &&
    !line.netAmount.trim() &&
    !line.vatRate.trim() &&
    !line.vatAmount.trim() &&
    !line.grossAmount.trim() &&
    !line.sourcePage.trim() &&
    !line.accountingAccountNumber.trim() &&
    !line.prepaidAccountNumber.trim() &&
    !line.recognitionStartDate.trim() &&
    !line.recognitionEndDate.trim() &&
    line.recognitionTreatment === "Immediate"
  );
}

/**
 * Converts an EditableInvoiceLine to the API input format.
 * Applies auto-calculation to blank arithmetic fields and sets derived flags.
 * Throws if sourcePage is supplied but not a positive integer.
 */
export function editableLineToInput(line: EditableInvoiceLine): InvoiceLineInput {
  const autoCalced = applyAutoCalcToLine(line);
  const netBlank = !line.netAmount.trim();
  const vatBlank = !line.vatAmount.trim();
  const grossBlank = !line.grossAmount.trim();

  const nullable = (value: string) => value.trim() || null;

  const pageResult = parsePageInput(line.sourcePage);
  if (pageResult.error) throw new Error(`Page: ${pageResult.error}`);

  return {
    lineNumber: nullable(line.lineNumber),
    descriptionOriginal: nullable(line.descriptionOriginal),
    description: nullable(line.description),
    quantity: nullable(line.quantity),
    unit: nullable(line.unit),
    unitPrice: nullable(line.unitPrice),
    netAmount: nullable(autoCalced.netAmount),
    netAmountDerived: netBlank && !!autoCalced.netAmount,
    vatRate: nullable(line.vatRate),
    vatAmount: nullable(autoCalced.vatAmount),
    vatAmountDerived: vatBlank && !!autoCalced.vatAmount,
    grossAmount: nullable(autoCalced.grossAmount),
    grossAmountDerived: grossBlank && !!autoCalced.grossAmount,
    sourcePage: pageResult.value,
    recognitionTreatment: line.recognitionTreatment,
    recognitionStartDate: nullable(line.recognitionStartDate),
    recognitionEndDate: nullable(line.recognitionEndDate),
    accountingAccountNumber: nullable(line.accountingAccountNumber),
    prepaidAccountNumber: nullable(line.prepaidAccountNumber),
  };
}

/**
 * Fill blank arithmetic fields (net, vatAmount, grossAmount) using conservative
 * auto-calculation. Does not modify explicitly entered values.
 */
export function applyAutoCalcToLine(line: EditableInvoiceLine): EditableInvoiceLine {
  let net = line.netAmount;
  let vat = line.vatAmount;
  let gross = line.grossAmount;

  if (!net.trim()) {
    const qtyP = safeParseDecimal(line.quantity);
    const upP = safeParseDecimal(line.unitPrice);
    if (!qtyP.error && !upP.error && qtyP.value && upP.value) {
      try { net = new Decimal(qtyP.value).times(new Decimal(upP.value)).toFixed(); } catch { /* ignore */ }
    }
  }

  if (!vat.trim()) {
    const netP = safeParseDecimal(net);
    const rateP = safeParseDecimal(line.vatRate);
    if (!netP.error && !rateP.error && netP.value && rateP.value) {
      const rv = new Decimal(rateP.value);
      if (rv.gte(0) && rv.lte(100)) {
        try { vat = new Decimal(netP.value).times(rv).dividedBy(100).toFixed(); } catch { /* ignore */ }
      }
    }
  }

  if (!gross.trim()) {
    const netP = safeParseDecimal(net);
    const vatP = safeParseDecimal(vat);
    if (!netP.error && !vatP.error && netP.value !== null && vatP.value !== null) {
      try { gross = new Decimal(netP.value).plus(new Decimal(vatP.value)).toFixed(); } catch { /* ignore */ }
    }
  }

  return { ...line, netAmount: net, vatAmount: vat, grossAmount: gross };
}

/**
 * Validate recognition and account fields for an invoice line at approval time.
 * Returns an error message or null if valid.
 */
export function validateLineRecognitionForApproval(
  line: InvoiceLineInput,
  lineNumber: number
): string | null {
  if (line.recognitionTreatment !== "Prepaid") return null;
  if (!line.recognitionStartDate || !line.recognitionEndDate) {
    return `Line ${lineNumber}: Prepaid treatment requires both start and end dates.`;
  }
  if (line.recognitionEndDate < line.recognitionStartDate) {
    return `Line ${lineNumber}: Recognition end date must be on or after start date.`;
  }
  if (!line.accountingAccountNumber) {
    return `Line ${lineNumber}: Prepaid treatment requires an expense account (Accounting Account No.).`;
  }
  if (!line.prepaidAccountNumber) {
    return `Line ${lineNumber}: Prepaid treatment requires a prepaid asset account.`;
  }
  return null;
}

export function sumInvoiceLineAmounts(lines: EditableInvoiceLine[]): { sum: string; invalidLineNumbers: number[] } {
  let sum = toDecimal(null);
  const invalidLineNumbers: number[] = [];

  lines.forEach((line, index) => {
    const parsed = safeParseDecimal(line.netAmount);
    if (parsed.error) {
      invalidLineNumbers.push(index + 1);
      return;
    }
    if (parsed.value !== null) sum = sum.plus(toDecimal(parsed.value));
  });

  return { sum: sum.toFixed(), invalidLineNumbers };
}
