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
  extendedPrice: nullableDecimal,
  sourceAmount: nullableDecimal,
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
    "extendedPrice": decimal-string | null,
    "sourceAmount": decimal-string | null,
    "netAmount": decimal-string | null,
    "vatRate": decimal-string | null,
    "vatAmount": decimal-string | null,
    "grossAmount": decimal-string | null,
    "sourcePage": positive-integer | null
  }]
}

Rules:
- Never invent, infer, or calculate a missing or unreadable value. Use null.
- Read each visible invoice total and its label independently. Use net/subtotal + VAT/tax = gross/total only as a consistency check when OCR text contains ambiguous competing readings.
- Use total arithmetic only to choose between values that are actually visible in the document. Never calculate, infer, or invent a total that is absent or unreadable; return null instead.
- Return invoiceDate and dueDate as YYYY-MM-DD when the date is unambiguous; otherwise return null.
- Preserve original-language vendor and line-description text exactly in vendorOriginal and descriptionOriginal.
- Put English-normalized vendor and description text only in vendorNormalized and description.
- vendorOriginal and vendorNormalized must contain only the vendor's legal or trading name. Never include its postal address, contact details, VAT/Tax labels, Tax ID value, or the entire document header in either vendor-name field.
- Extract vendorTaxId only when a VAT or Tax ID is explicitly visible in the document. Preserve its displayed value exactly; never infer or invent it.
- Extract every invoice table row in document order. Do not combine or reorder rows.
- Respect explicit document column headers including Qty, Quantity, U.Price, Unit Price, Price, Amount, and VAT %. Preserve decimal quantities exactly as printed.
- When both U.Price/Unit Price and Price are visible, U.Price/Unit Price is unitPrice and Price is extendedPrice. Never put an extended Price into unitPrice. Use quantity × unitPrice only as a decimal coherence check against an explicit extendedPrice.
- Put an explicit document Amount column in sourceAmount first. Do not assume Amount is line net: determine whether its aggregate reconciles with the invoice net or gross header. Do not infer or calculate line net, VAT, or gross values that are not explicitly printed.
- Keep discounts, fees, credits, surcharges, shipping, and adjustments as distinct lines.
- Do not perform inventory, SKU, stock, catalog, accounting, tax-code, or expense categorization.
- All money, percentage, and quantity values must be plain decimal strings without currency symbols, grouping separators, or percent signs. Never return numbers for them.
- sourcePage must be a JSON integer when the page is known, otherwise null.
- Return an empty lines array only when there are no invoice rows to extract.`;
