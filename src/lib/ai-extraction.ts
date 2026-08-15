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
- Read each visible invoice total and its label independently. Use net/subtotal + VAT/tax = gross/total only as a consistency check when OCR text contains ambiguous competing readings.
- Use total arithmetic only to choose between values that are actually visible in the document. Never calculate, infer, or invent a total that is absent or unreadable; return null instead.
- A source column is a VAT rate column only when its header contains a tax-specific keyword such as "VAT", "Vat", "Tax", "GST", or "TVA" combined with a percentage sign (examples: "VAT %", "Vat %", "Tax %", "GST %", "TVA %"); place its value in line.vatRate. Do not treat discount, surcharge, fee, rebate, or other non-tax percentage columns (for example "Disc.%", "Discount %", "Surcharge %") as VAT rate columns.
- Do not assume a column named "Amount" is always net. When a source table row contains all of: a quantity column, a unit-price column, a separate per-line extended value (such as "Price" or "Subtotal" — equal to Qty × unit price), a separate "Amount" column, and a tax-rate column (e.g. "VAT %"), treat the "Amount" as the VAT-inclusive line total and populate line.grossAmount from it. This structural pattern does not extend to tables with only one or two money columns; in those cases read the column label to determine whether it is net or gross.
- When a line amount is VAT-inclusive (line.grossAmount is set) and the line's VAT rate is known (line.vatRate is set), derive: line.netAmount = line.grossAmount / (1 + line.vatRate / 100); line.vatAmount = line.grossAmount − line.netAmount. This is the only permitted exception to the "never calculate" rule; apply it only when both grossAmount and vatRate are explicitly present for that line.
- When source line columns explicitly provide separate net and VAT amounts, record them directly in line.netAmount and line.vatAmount without recalculating.
- Never move a value into a different field to fill a gap (for example, do not copy a gross amount into line.netAmount simply because the net field would otherwise be empty).
- When source table column semantics are ambiguous, use invoice-level netAmount, vatAmount, and grossAmount as a sanity check to confirm the interpretation, not as the primary basis for assigning column meanings.
- Return invoiceDate and dueDate as YYYY-MM-DD when the date is unambiguous; otherwise return null.
- Preserve original-language vendor and line-description text exactly in vendorOriginal and descriptionOriginal.
- Put English-normalized vendor and description text only in vendorNormalized and description.
- vendorOriginal and vendorNormalized must contain only the vendor's legal or trading name. Never include its postal address, contact details, VAT/Tax labels, Tax ID value, or the entire document header in either vendor-name field.
- Extract vendorTaxId only when a VAT or Tax ID is explicitly visible in the document. Preserve its displayed value exactly; never infer or invent it.
- Extract every invoice table row in document order. Do not combine or reorder rows.
- Keep discounts, fees, credits, surcharges, shipping, and adjustments as distinct lines.
- Do not perform inventory, SKU, stock, catalog, accounting, tax-code, or expense categorization.
- All money, percentage, and quantity values must be plain decimal strings without currency symbols, grouping separators, or percent signs. Never return numbers for them.
- sourcePage must be a JSON integer when the page is known, otherwise null.
- Return an empty lines array only when there are no invoice rows to extract.`;
