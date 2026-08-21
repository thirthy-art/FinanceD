export { parseInvoiceFields, buildTextExtractionFallbackLine } from "./local-invoice-parser";
export type { InvoiceFields } from "./local-invoice-parser";

// ─── PDF text extraction (embedded text only) ─────────────────────────────────

export async function extractPdfText(
  bytes: Buffer | Uint8Array
): Promise<{ text: string; ocrPerformed: boolean }> {
  try {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(bytes), verbosity: 0 });
    try {
      const result = await parser.getText();
      const text = (result.text ?? "").trim();
      if (text.length > 20) {
        return { text, ocrPerformed: false };
      }
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  } catch {
    // fall through to empty result
  }
  return { text: "", ocrPerformed: false };
}

// ─── Image OCR via tesseract.js (WASM — no native deps) ──────────────────────

export async function extractImageText(
  bytes: Buffer | Uint8Array
): Promise<{ text: string; ocrPerformed: boolean }> {
  try {
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng");
    try {
      const { data } = await worker.recognize(Buffer.from(bytes));
      return { text: data.text.trim(), ocrPerformed: true };
    } finally {
      await worker.terminate();
    }
  } catch (err) {
    console.error("OCR failed:", err);
    return { text: "", ocrPerformed: false };
  }
}
