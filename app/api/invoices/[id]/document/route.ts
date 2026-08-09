import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/src/db";
import { supplierInvoiceDocuments } from "@/src/db/schema";
import { eq } from "drizzle-orm";
import fs from "fs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();

  const [doc] = await db
    .select()
    .from(supplierInvoiceDocuments)
    .where(eq(supplierInvoiceDocuments.invoiceId, Number(id)));

  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!fs.existsSync(doc.storagePath)) {
    return NextResponse.json({ error: "File not on disk" }, { status: 404 });
  }

  const buffer = fs.readFileSync(doc.storagePath);
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Disposition": `inline; filename="${doc.originalFilename}"`,
    },
  });
}
