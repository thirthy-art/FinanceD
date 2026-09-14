import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/src/db";
import {
  cashForecastItems,
  paymentAccountAssets,
  paymentAccounts,
  paymentBalanceSnapshots,
  paymentEvents,
  supplierInvoices,
  vendors,
} from "@/src/db/schema";

export async function loadDashboardSourceRows(companyId: number) {
  const db = getDb();
  const [invoiceRows, forecastRows, accounts, openings, eventRows, snapshotRows] = await Promise.all([
    db.select({
      id: supplierInvoices.id,
      vendorName: vendors.name,
      invoiceNumber: supplierInvoices.invoiceNumber,
      invoiceDate: supplierInvoices.invoiceDate,
      dueDate: supplierInvoices.dueDate,
      baseGrossAmount: supplierInvoices.baseGrossAmount,
      status: supplierInvoices.status,
      paymentStatus: supplierInvoices.paymentStatus,
      createdAt: supplierInvoices.createdAt,
    }).from(supplierInvoices)
      .leftJoin(vendors, and(eq(supplierInvoices.vendorId, vendors.id), eq(vendors.companyId, companyId)))
      .where(eq(supplierInvoices.companyId, companyId))
      .orderBy(desc(supplierInvoices.createdAt)),
    db.select().from(cashForecastItems)
      .where(eq(cashForecastItems.companyId, companyId))
      .orderBy(asc(cashForecastItems.date)),
    db.select().from(paymentAccounts)
      .where(eq(paymentAccounts.companyId, companyId))
      .orderBy(asc(paymentAccounts.name)),
    db.select().from(paymentAccountAssets)
      .where(eq(paymentAccountAssets.companyId, companyId)),
    db.select().from(paymentEvents)
      .where(eq(paymentEvents.companyId, companyId))
      .orderBy(asc(paymentEvents.eventDate), asc(paymentEvents.id)),
    db.select().from(paymentBalanceSnapshots)
      .where(eq(paymentBalanceSnapshots.companyId, companyId))
      .orderBy(asc(paymentBalanceSnapshots.asOf)),
  ]);

  return { invoiceRows, forecastRows, accounts, openings, eventRows, snapshotRows };
}
