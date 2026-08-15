import { z } from "zod";
import { parseDecimalInput, safeParseDecimal, toDecimal } from "./invoice-validation";

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
  // Carry recognition fields through unchanged
  normalized.recognitionTreatment = line.recognitionTreatment ?? "Immediate";
  normalized.recognitionStartDate = line.recognitionStartDate ?? null;
  normalized.recognitionEndDate = line.recognitionEndDate ?? null;
  normalized.accountingAccountNumber = line.accountingAccountNumber ?? null;
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
  };
}

export function editableLineToInput(line: EditableInvoiceLine): InvoiceLineInput {
  const nullable = (value: string) => value.trim() || null;
  return {
    lineNumber: nullable(line.lineNumber),
    descriptionOriginal: nullable(line.descriptionOriginal),
    description: nullable(line.description),
    quantity: nullable(line.quantity),
    unit: nullable(line.unit),
    unitPrice: nullable(line.unitPrice),
    netAmount: nullable(line.netAmount),
    vatRate: nullable(line.vatRate),
    vatAmount: nullable(line.vatAmount),
    grossAmount: nullable(line.grossAmount),
    sourcePage: line.sourcePage.trim() ? Number(line.sourcePage) : null,
    recognitionTreatment: line.recognitionTreatment,
    recognitionStartDate: nullable(line.recognitionStartDate),
    recognitionEndDate: nullable(line.recognitionEndDate),
    accountingAccountNumber: nullable(line.accountingAccountNumber),
  };
}

/**
 * Validate recognition fields for an invoice line at approval time.
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
