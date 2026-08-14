import { randomUUID } from "crypto";
import { mkdir, unlink, writeFile } from "fs/promises";
import path from "path";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/src/db";
import { supplierInvoices, supplierInvoiceDocuments } from "@/src/db/schema";
import { extractPdfText, extractImageText, parseInvoiceFields } from "@/src/lib/extract";
import { getOrCreateCompany } from "@/src/lib/db-helpers";

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? "./uploads";
const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/tiff", "image/webp"];

async function removeUpload(storagePath: string) {
  try {
    await unlink(storagePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("Could not remove an incomplete invoice upload.");
    }
  }
}

export async function POST(req: NextRequest) {
  let data: FormData;
  try {
    data = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload request." }, { status: 400 });
  }

  const file = data.get("file");
  const requestId = data.get("requestId");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }
  if (typeof requestId !== "string" || !/^[a-zA-Z0-9-]{16,100}$/.test(requestId)) {
    return NextResponse.json({ error: "Invalid upload request identifier." }, { status: 400 });
  }

  const mimeType = file.type || "application/octet-stream";
  if (!ALLOWED_TYPES.includes(mimeType)) {
    return NextResponse.json({ error: "Unsupported file type. Upload a PDF, JPEG, PNG, TIFF, or WebP." }, { status: 400 });
  }

  const db = getDb();
  const [existing] = await db
    .select({ id: supplierInvoices.id })
    .from(supplierInvoices)
    .where(eq(supplierInvoices.uploadRequestId, requestId));
  if (existing) return NextResponse.json({ invoiceId: existing.id, reused: true });

  const originalFilename = file.name;
  const ext = path.extname(originalFilename) || (mimeType === "application/pdf" ? ".pdf" : ".jpg");
  const storageName = `${Date.now()}-${randomUUID()}${ext}`;
  const storagePath = path.join(UPLOAD_DIR, storageName);

  try {
    await mkdir(UPLOAD_DIR, { recursive: true });
    await writeFile(storagePath, Buffer.from(await file.arrayBuffer()));
  } catch {
    return NextResponse.json({ error: "The document could not be stored. Please retry." }, { status: 500 });
  }

  let extracted: { text: string; ocrPerformed: boolean };
  try {
    extracted = mimeType === "application/pdf"
      ? await extractPdfText(storagePath)
      : await extractImageText(storagePath);
  } catch {
    await removeUpload(storagePath);
    return NextResponse.json(
      { error: "The document was uploaded, but its initial processing failed. Please retry." },
      { status: 422 },
    );
  }

  try {
    const fields = parseInvoiceFields(extracted.text);
    const company = await getOrCreateCompany();
    const invoiceCurrency = fields.currency ?? company.baseCurrency;
    const isSameCurrency = invoiceCurrency === company.baseCurrency;

    const result = await db.transaction(async (tx) => {
      const [invoice] = await tx
        .insert(supplierInvoices)
        .values({
          companyId: company.id,
          uploadRequestId: requestId,
          status: "draft",
          currency: invoiceCurrency,
          currencyType: "fiat",
          fxRateToBase: isSameCurrency ? "1" : null,
        })
        .onConflictDoNothing({ target: supplierInvoices.uploadRequestId })
        .returning({ id: supplierInvoices.id });

      if (!invoice) {
        const [duplicate] = await tx
          .select({ id: supplierInvoices.id })
          .from(supplierInvoices)
          .where(eq(supplierInvoices.uploadRequestId, requestId));
        if (!duplicate) throw new Error("Upload request conflict could not be resolved.");
        return { invoiceId: duplicate.id, reused: true };
      }

      await tx.insert(supplierInvoiceDocuments).values({
        invoiceId: invoice.id,
        originalFilename,
        storagePath,
        mimeType,
        extractedText: extracted.text || null,
        ocrPerformed: extracted.ocrPerformed,
      });
      return { invoiceId: invoice.id, reused: false };
    });

    if (result.reused) await removeUpload(storagePath);
    return NextResponse.json({ ...result, fields });
  } catch {
    await removeUpload(storagePath);
    return NextResponse.json({ error: "The invoice record could not be created. Please retry safely." }, { status: 500 });
  }
}
