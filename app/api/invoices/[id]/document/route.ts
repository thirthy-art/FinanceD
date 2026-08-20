import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/src/db";
import { supplierInvoiceDocuments, supplierInvoices } from "@/src/db/schema";
import { and, eq } from "drizzle-orm";
import { getActiveCompanyFromRequest } from "@/src/lib/active-company";
import { DocumentNotFoundError, readDocument } from "@/src/lib/document-storage";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const company = await getActiveCompanyFromRequest(req);
  if (company instanceof Response) return company;
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
  let buffer: Buffer;
  try {
    buffer = await readDocument(document.storagePath);
  } catch (error) {
    return error instanceof DocumentNotFoundError
      ? NextResponse.json({ error: "File not on disk" }, { status: 404 })
      : NextResponse.json({ error: "The document storage service is unavailable." }, { status: 503 });
  }
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": document.mimeType,
      "Content-Disposition": `inline; filename="${document.originalFilename}"`,
    },
  });
}
