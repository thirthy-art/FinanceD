import { desc, eq } from "drizzle-orm";
import { getDb } from "@/src/db";
import { supplierInvoices, vendors } from "@/src/db/schema";
import { invoicesToCsv } from "@/src/lib/invoice-csv";

export async function GET() {
  const db = getDb();
  const invoices = await db
    .select({
      vendor: vendors.name,
      invoiceNumber: supplierInvoices.invoiceNumber,
      invoiceDate: supplierInvoices.invoiceDate,
      dueDate: supplierInvoices.dueDate,
      currency: supplierInvoices.currency,
      netAmount: supplierInvoices.netAmount,
      vatAmount: supplierInvoices.vatAmount,
      grossAmount: supplierInvoices.grossAmount,
      status: supplierInvoices.status,
    })
    .from(supplierInvoices)
    .leftJoin(vendors, eq(supplierInvoices.vendorId, vendors.id))
    .orderBy(desc(supplierInvoices.createdAt));

  const exportDate = new Date().toISOString().slice(0, 10);
  return new Response(`\uFEFF${invoicesToCsv(invoices)}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="invoices-${exportDate}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
