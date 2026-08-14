import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getDb } from "@/src/db";
import { supplierInvoices, supplierInvoiceDocuments } from "@/src/db/schema";
import { extractPdfText, extractImageText, parseInvoiceFields } from "@/src/lib/extract";
import { getOrCreateCompany } from "@/src/lib/db-helpers";

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? "./uploads";

export async function POST(req: NextRequest) {
  let data: FormData;
  try {
    data = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = data.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);
  const originalFilename = file.name;
  const mimeType = file.type || "application/octet-stream";

  const allowed = ["application/pdf", "image/jpeg", "image/png", "image/tiff", "image/webp"];
  if (!allowed.includes(mimeType)) {
    return NextResponse.json({ error: "Unsupported file type. Upload a PDF or image." }, { status: 400 });
  }

  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const ext = path.extname(originalFilename) || (mimeType === "application/pdf" ? ".pdf" : ".jpg");
  const storageName = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
  const storagePath = path.join(UPLOAD_DIR, storageName);
  fs.writeFileSync(storagePath, buffer);

  let extracted: { text: string; ocrPerformed: boolean };
  try {
    if (mimeType === "application/pdf") {
      extracted = await extractPdfText(storagePath);
    } else {
      extracted = await extractImageText(storagePath);
    }
  } catch (err) {
    console.error("Extraction error:", err);
    extracted = { text: "", ocrPerformed: false };
  }

  const fields = parseInvoiceFields(extracted.text);

  const db = getDb();
  const company = await getOrCreateCompany();

  const invoiceCurrency = fields.currency ?? company.baseCurrency;
  const isSameCurrency = invoiceCurrency === company.baseCurrency;

  const [invoice] = await db
    .insert(supplierInvoices)
    .values({
      companyId: company.id,
      status: "draft",
      currency: invoiceCurrency,
      currencyType: "fiat",
      fxRateToBase: isSameCurrency ? "1" : null,
    })
    .returning();

  await db.insert(supplierInvoiceDocuments).values({
    invoiceId: invoice.id,
    originalFilename,
    storagePath,
    mimeType,
    extractedText: extracted.text || null,
    ocrPerformed: extracted.ocrPerformed,
  });

  return NextResponse.json({
    invoiceId: invoice.id,
    fields,
    extractedText: extracted.text,
    ocrPerformed: extracted.ocrPerformed,
  });
}
