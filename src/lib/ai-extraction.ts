import { z } from "zod";

const nullableText = z.string().nullable();
const nullableDecimal = z
  .string()
  .regex(/^-?(?:\d+(?:\.\d+)?|\.\d+)$/, "Expected a plain decimal string")
  .nullable();

export const AiInvoiceLineSchema = z.object({
  lineNumber: nullableText,
  descriptionOriginal: nullableText,
  description: nullableText,
  quantity: nullableDecimal,
  unit: nullableText,
  unitPrice: nullableDecimal,
  netAmount: nullableDecimal,
  vatRate: nullableDecimal,
  vatAmount: nullableDecimal,
  grossAmount: nullableDecimal,
  sourcePage: z.number().int().positive().nullable(),
}).strict();

export const AiInvoiceExtractionSchema = z.object({
  vendorOriginal: nullableText,
  vendorNormalized: nullableText,
  vendorTaxId: nullableText,
  invoiceNumber: nullableText,
  invoiceDate: nullableText,
  dueDate: nullableText,
  currency: nullableText,
  netAmount: nullableDecimal,
  vatAmount: nullableDecimal,
  grossAmount: nullableDecimal,
  lines: z.array(AiInvoiceLineSchema),
}).strict();

export type AiInvoiceExtraction = z.infer<typeof AiInvoiceExtractionSchema>;

export const AI_EXTRACTION_PROMPT = `Extract this supplier invoice and return JSON only, with no Markdown or explanation.

Use exactly this shape and include every field:
{
  "vendorOriginal": string | null,
  "vendorNormalized": string | null,
  "vendorTaxId": string | null,
  "invoiceNumber": string | null,
  "invoiceDate": ISO-date-string | null,
  "dueDate": ISO-date-string | null,
  "currency": string | null,
  "netAmount": decimal-string | null,
  "vatAmount": decimal-string | null,
  "grossAmount": decimal-string | null,
  "lines": [{
    "lineNumber": string | null,
    "descriptionOriginal": string | null,
    "description": string | null,
    "quantity": decimal-string | null,
    "unit": string | null,
    "unitPrice": decimal-string | null,
    "netAmount": decimal-string | null,
    "vatRate": decimal-string | null,
    "vatAmount": decimal-string | null,
    "grossAmount": decimal-string | null,
    "sourcePage": positive-integer | null
  }]
}

Rules:
- Never invent, infer, or calculate a missing or unreadable value. Use null.
- Return invoiceDate and dueDate as YYYY-MM-DD when the date is unambiguous; otherwise return null.
- Preserve original-language vendor and line-description text exactly in vendorOriginal and descriptionOriginal.
- Put English-normalized vendor and description text only in vendorNormalized and description.
- Extract vendorTaxId only when a VAT or Tax ID is explicitly visible in the document. Preserve its displayed value exactly; never infer or invent it.
- Extract every invoice table row in document order. Do not combine or reorder rows.
- Keep discounts, fees, credits, surcharges, shipping, and adjustments as distinct lines.
- Do not perform inventory, SKU, stock, catalog, accounting, tax-code, or expense categorization.
- All money, percentage, and quantity values must be plain decimal strings without currency symbols, grouping separators, or percent signs. Never return numbers for them.
- sourcePage must be a JSON integer when the page is known, otherwise null.
- Return an empty lines array only when there are no invoice rows to extract.`;
