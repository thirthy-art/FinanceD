import fs from "fs";

export { parseInvoiceFields } from "./local-invoice-parser";
export type { InvoiceFields } from "./local-invoice-parser";

// ─── PDF text extraction (embedded text only) ─────────────────────────────────

export async function extractPdfText(
  filePath: string
): Promise<{ text: string; ocrPerformed: boolean }> {
  try {
    const { PDFParse } = await import("pdf-parse");
    const buffer = fs.readFileSync(filePath);
    const parser = new PDFParse({ data: new Uint8Array(buffer), verbosity: 0 });
    const result = await parser.getText();
    const text = (result.text ?? "").trim();
    if (text.length > 20) {
      return { text, ocrPerformed: false };
    }
  } catch {
    // fall through to empty result
  }
  return { text: "", ocrPerformed: false };
}

// ─── Image OCR via tesseract.js (WASM — no native deps) ──────────────────────

export async function extractImageText(
  filePath: string
): Promise<{ text: string; ocrPerformed: boolean }> {
  try {
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng");
    try {
      const { data } = await worker.recognize(filePath);
      return { text: data.text.trim(), ocrPerformed: true };
    } finally {
      await worker.terminate();
    }
  } catch (err) {
    console.error("OCR failed:", err);
    return { text: "", ocrPerformed: false };
  }
}
