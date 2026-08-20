import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/src/db";
import { supplierInvoiceLines, supplierInvoices, vendors } from "@/src/db/schema";
import { invoiceExportToXlsx } from "@/src/lib/invoice-xlsx";
import { getActiveCompanyFromRequest } from "@/src/lib/active-company";

export async function GET(request: Request) {
  const company = await getActiveCompanyFromRequest(request);
  if (company instanceof Response) return company;
  const db = getDb();
  const [invoices, lines] = await Promise.all([
    db.select({
      id: supplierInvoices.id,
      vendorName: vendors.name,
      vendorTaxId: vendors.taxId,
      vendorExternalNumber: vendors.externalVendorNumber,
      invoiceNumber: supplierInvoices.invoiceNumber,
      invoiceDate: supplierInvoices.invoiceDate,
      dueDate: supplierInvoices.dueDate,
      currency: supplierInvoices.currency,
      currencyType: supplierInvoices.currencyType,
      netAmount: supplierInvoices.netAmount,
      vatAmount: supplierInvoices.vatAmount,
      grossAmount: supplierInvoices.grossAmount,
      baseNetAmount: supplierInvoices.baseNetAmount,
      baseVatAmount: supplierInvoices.baseVatAmount,
      baseGrossAmount: supplierInvoices.baseGrossAmount,
      status: supplierInvoices.status,
      paymentStatus: supplierInvoices.paymentStatus,
      paidDate: supplierInvoices.paidDate,
    }).from(supplierInvoices)
      .leftJoin(vendors, and(
        eq(supplierInvoices.vendorId, vendors.id),
        eq(vendors.companyId, company.id),
      ))
      .where(eq(supplierInvoices.companyId, company.id))
      .orderBy(desc(supplierInvoices.createdAt)),
    db.select({
      invoiceId: supplierInvoices.id,
      vendorName: vendors.name,
      vendorTaxId: vendors.taxId,
      invoiceNumber: supplierInvoices.invoiceNumber,
      invoiceDate: supplierInvoices.invoiceDate,
      invoiceStatus: supplierInvoices.status,
      currency: supplierInvoices.currency,
      currencyType: supplierInvoices.currencyType,
      lineNumber: supplierInvoiceLines.lineNumber,
      descriptionOriginal: supplierInvoiceLines.descriptionOriginal,
      description: supplierInvoiceLines.description,
      quantity: supplierInvoiceLines.quantity,
      unit: supplierInvoiceLines.unit,
      unitPrice: supplierInvoiceLines.unitPrice,
      netAmount: supplierInvoiceLines.netAmount,
      vatRate: supplierInvoiceLines.vatRate,
      vatAmount: supplierInvoiceLines.vatAmount,
      grossAmount: supplierInvoiceLines.grossAmount,
      sourcePage: supplierInvoiceLines.sourcePage,
      recognitionTreatment: supplierInvoiceLines.recognitionTreatment,
      recognitionStartDate: supplierInvoiceLines.recognitionStartDate,
      recognitionEndDate: supplierInvoiceLines.recognitionEndDate,
      accountingAccountNumber: supplierInvoiceLines.accountingAccountNumber,
      prepaidAccountNumber: supplierInvoiceLines.prepaidAccountNumber,
    }).from(supplierInvoiceLines)
      .innerJoin(supplierInvoices, eq(supplierInvoiceLines.invoiceId, supplierInvoices.id))
      .leftJoin(vendors, and(
        eq(supplierInvoices.vendorId, vendors.id),
        eq(vendors.companyId, company.id),
      ))
      .where(eq(supplierInvoices.companyId, company.id))
      .orderBy(desc(supplierInvoices.createdAt), asc(supplierInvoiceLines.position)),
  ]);

  const bytes = await invoiceExportToXlsx(invoices, lines);
  const exportDate = new Date().toISOString().slice(0, 10);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="invoices-${exportDate}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
