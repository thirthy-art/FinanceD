import { NextResponse } from "next/server";
import { getDb } from "@/src/db";
import { supplierInvoices, vendors } from "@/src/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { getActiveCompanyFromRequest } from "@/src/lib/active-company";

export async function GET(request: Request) {
  const company = await getActiveCompanyFromRequest(request);
  const db = getDb();
  const rows = await db
    .select({
      id: supplierInvoices.id,
      invoiceNumber: supplierInvoices.invoiceNumber,
      invoiceDate: supplierInvoices.invoiceDate,
      dueDate: supplierInvoices.dueDate,
      currency: supplierInvoices.currency,
      currencyType: supplierInvoices.currencyType,
      grossAmount: supplierInvoices.grossAmount,
      status: supplierInvoices.status,
      vendorName: vendors.name,
      createdAt: supplierInvoices.createdAt,
    })
    .from(supplierInvoices)
    .leftJoin(vendors, and(
      eq(supplierInvoices.vendorId, vendors.id),
      eq(vendors.companyId, company.id),
    ))
    .where(eq(supplierInvoices.companyId, company.id))
    .orderBy(desc(supplierInvoices.createdAt));

  return NextResponse.json(rows);
}
