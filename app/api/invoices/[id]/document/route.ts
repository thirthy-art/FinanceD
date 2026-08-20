import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/src/db";
import { supplierInvoiceDocuments, supplierInvoices } from "@/src/db/schema";
import { and, eq } from "drizzle-orm";
import fs from "fs";
import { getActiveCompanyFromRequest } from "@/src/lib/active-company";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const company = await getActiveCompanyFromRequest(req);
  const db = getDb();

  const [doc] = await db
    .select()
    .from(supplierInvoiceDocuments)
    .innerJoin(supplierInvoices, eq(supplierInvoiceDocuments.invoiceId, supplierInvoices.id))
    .where(and(
      eq(supplierInvoiceDocuments.invoiceId, Number(id)),
      eq(supplierInvoices.companyId, company.id),
    ));

  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const document = doc.supplier_invoice_documents;
  if (!fs.existsSync(document.storagePath)) {
    return NextResponse.json({ error: "File not on disk" }, { status: 404 });
  }

  const buffer = fs.readFileSync(document.storagePath);
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": document.mimeType,
      "Content-Disposition": `inline; filename="${document.originalFilename}"`,
    },
  });
}
