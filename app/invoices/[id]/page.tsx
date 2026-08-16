import { notFound } from "next/navigation";
import { getDb } from "@/src/db";
import {
  supplierInvoices,
  supplierInvoiceDocuments,
  supplierInvoiceLines,
  vendors,
  costCentres,
  chartOfAccounts,
} from "@/src/db/schema";
import { eq, asc } from "drizzle-orm";
import InvoiceReview from "@/src/components/InvoiceReview";
import Link from "next/link";
import { parseInvoiceFields } from "@/src/lib/extract";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();

  const [invoice] = await db
    .select()
    .from(supplierInvoices)
    .where(eq(supplierInvoices.id, Number(id)));

  if (!invoice) notFound();

  const [docs, vendorList, ccList, acctList, lineList] = await Promise.all([
    db.select().from(supplierInvoiceDocuments).where(eq(supplierInvoiceDocuments.invoiceId, invoice.id)),
    db.select({ id: vendors.id, name: vendors.name }).from(vendors).where(eq(vendors.companyId, invoice.companyId)),
    db.select().from(costCentres).where(eq(costCentres.companyId, invoice.companyId)),
    db.select().from(chartOfAccounts).where(eq(chartOfAccounts.companyId, invoice.companyId)),
    db.select().from(supplierInvoiceLines).where(eq(supplierInvoiceLines.invoiceId, invoice.id)).orderBy(asc(supplierInvoiceLines.lineNumber)),
  ]);

  // Pre-fill extracted fields from the stored extracted text
  const extractedText = docs[0]?.extractedText ?? "";
  const extractedFields = parseInvoiceFields(extractedText) as Record<string, string>;

  return (
    <div>
      <div style={{ marginBottom: 20, display: "flex", alignItems: "center", gap: 8 }}>
        <Link href="/" style={{ color: "#2563eb", textDecoration: "none", fontSize: 13 }}>
          ← All Invoices
        </Link>
        <span style={{ color: "#cbd5e1" }}>›</span>
        <span style={{ fontSize: 13, color: "#64748b" }}>
          Invoice #{invoice.id}
          {invoice.invoiceNumber ? ` · ${invoice.invoiceNumber}` : ""}
        </span>
      </div>
      <InvoiceReview
        invoice={invoice}
        documents={docs}
        vendors={vendorList}
        costCentres={ccList}
        accounts={acctList}
        extractedFields={extractedFields}
        initialLines={lineList}
      />
    </div>
  );
}
