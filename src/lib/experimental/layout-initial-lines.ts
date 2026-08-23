/**
 * Server-page connection: turns deterministic layout extraction of a
 * born-digital PDF into initial editable invoice lines for the normal
 * invoice editor. Nothing is persisted here — the editor's explicit Save
 * remains the only path that writes lines to the database. Callers keep
 * persisted DB lines authoritative and fall back to the existing text-based
 * behavior whenever no initial lines are returned.
 */
import { emptyEditableInvoiceLine, type EditableInvoiceLine } from "../invoice-lines";
import { readDocument } from "../document-storage";
import { extractDeterministicLayoutInvoiceLines } from "./layout-line-extraction";

/**
 * Returns deterministic initial lines for a born-digital PDF with no
 * persisted invoice lines, or null when the document is not a digital PDF or
 * the extraction is unusable/failed. Never throws: layout failures are
 * non-fatal for page rendering. No AI is involved.
 */
export async function getDeterministicInitialInvoiceLines(input: {
  mimeType: string;
  storagePath: string;
  extractedText: string | null;
  persistedLineCount: number;
}): Promise<EditableInvoiceLine[] | null> {
  if (input.persistedLineCount > 0) return null;
  if (input.mimeType !== "application/pdf") return null;
  if (!input.extractedText?.trim()) return null;

  let result;
  try {
    const pdfBytes = await readDocument(input.storagePath);
    result = await extractDeterministicLayoutInvoiceLines(pdfBytes);
  } catch {
    return null;
  }
  if (!result.useful) return null;

  return result.lines.map((line) => ({
    ...emptyEditableInvoiceLine(),
    lineNumber: line.lineNumber ?? "",
    descriptionOriginal: line.descriptionOriginal ?? "",
    quantity: line.quantity ?? "",
    unit: line.unit ?? "",
    unitPrice: line.unitPrice ?? "",
    netAmount: line.netAmount ?? "",
    vatRate: line.vatRate ?? "",
    vatAmount: line.vatAmount ?? "",
    grossAmount: line.grossAmount ?? "",
    sourcePage: String(line.sourcePage),
  }));
}
