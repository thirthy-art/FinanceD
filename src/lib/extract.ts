import fs from "fs";

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
  // Scanned PDF: degrade gracefully, user fills manually
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

// ─── Field parsing ────────────────────────────────────────────────────────────

export interface InvoiceFields {
  vendorName?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  dueDate?: string;
  currency?: string;
  netAmount?: string;
  vatAmount?: string;
  grossAmount?: string;
}

export function parseInvoiceFields(text: string): InvoiceFields {
  if (!text) return {};
  const fields: InvoiceFields = {};
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // Invoice number
  for (const line of lines) {
    const m = line.match(/invoice\s*(?:no|number|#)[:\s#]*([A-Z0-9\-\/]+)/i);
    if (m) { fields.invoiceNumber = m[1]; break; }
  }

  // Dates (deduped, up to 2)
  const datePattern = /\b(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2})\b/g;
  const dates: string[] = [];
  for (const line of lines) {
    let m: RegExpExecArray | null;
    while ((m = datePattern.exec(line)) !== null) {
      const d = normalizeDate(m[1]);
      if (d && !dates.includes(d)) dates.push(d);
    }
  }
  if (dates[0]) fields.invoiceDate = dates[0];
  if (dates[1]) fields.dueDate = dates[1];

  // Currency code
  const curr = text.match(/\b(USD|EUR|GBP|CHF|CAD|AUD|RON|JPY|SEK|NOK|DKK)\b/i);
  if (curr) fields.currency = curr[1].toUpperCase();

  // Amounts by keyword
  for (const line of lines) {
    const amount = extractLargestAmount(line);
    if (!amount) continue;
    if (/total|gross|amount\s*due|amount\s*payable/i.test(line) && !fields.grossAmount) {
      fields.grossAmount = amount;
    } else if (/\b(net|subtotal|before\s*tax)\b/i.test(line) && !fields.netAmount) {
      fields.netAmount = amount;
    } else if (/\b(vat|tax|gst|hst)\b/i.test(line) && !fields.vatAmount) {
      fields.vatAmount = amount;
    }
  }

  // Vendor name: first substantive line before "invoice"
  const invoiceIdx = lines.findIndex((l) => /\binvoice\b/i.test(l));
  const searchEnd = invoiceIdx > 0 ? Math.min(invoiceIdx, 4) : Math.min(lines.length, 4);
  for (const l of lines.slice(0, searchEnd)) {
    if (l.length > 3 && !/^(to:|from:|date:|bill|attention)/i.test(l)) {
      fields.vendorName = l;
      break;
    }
  }

  return fields;
}

function normalizeDate(raw: string): string | null {
  const parts = raw.split(/[\/\-\.]/);
  if (parts.length !== 3) return null;
  let y: number, m: number, d: number;
  if (parts[0].length === 4) {
    [y, m, d] = parts.map(Number);
  } else {
    [d, m, y] = parts.map(Number);
    if (y < 100) y += y >= 50 ? 1900 : 2000;
  }
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function extractLargestAmount(line: string): string | null {
  const matches = line.match(/[\d,]+\.?\d*/g);
  if (!matches) return null;
  const nums = matches.map((s) => parseFloat(s.replace(/,/g, ""))).filter((n) => n > 0.01);
  if (!nums.length) return null;
  return Math.max(...nums).toFixed(2);
}
