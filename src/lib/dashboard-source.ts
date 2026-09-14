import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/src/db";
import {
  cashForecastItems,
  paymentAccountAssets,
  paymentAccounts,
  paymentBalanceSnapshots,
  paymentEvents,
  reconciliationRuns,
  reconciliationTransactions,
  supplierInvoices,
  vendors,
} from "@/src/db/schema";

export async function loadDashboardSourceRows(companyId: number) {
  const db = getDb();
  const [invoiceRows, forecastRows, accounts, openings, eventRows, snapshotRows, latestRuns] = await Promise.all([
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
    db.select({
      id: reconciliationRuns.id,
      playerLedgerImportId: reconciliationRuns.playerLedgerImportId,
    }).from(reconciliationRuns)
      .where(and(eq(reconciliationRuns.companyId, companyId), eq(reconciliationRuns.status, "completed")))
      .orderBy(desc(reconciliationRuns.updatedAt), desc(reconciliationRuns.id))
      .limit(1),
  ]);

  const latestRun = latestRuns[0] ?? null;
  const liabilityRows = latestRun
    ? await db.select({
        source: reconciliationTransactions.source,
        externalId: reconciliationTransactions.externalId,
        playerId: reconciliationTransactions.playerId,
        transactionType: reconciliationTransactions.transactionType,
        amount: reconciliationTransactions.amount,
        currency: reconciliationTransactions.currency,
        eventDate: reconciliationTransactions.eventDate,
        reference: reconciliationTransactions.reference,
        status: reconciliationTransactions.status,
        statusProvided: reconciliationTransactions.statusProvided,
      }).from(reconciliationTransactions)
        .where(and(
          eq(reconciliationTransactions.companyId, companyId),
          eq(reconciliationTransactions.importId, latestRun.playerLedgerImportId),
          eq(reconciliationTransactions.source, "player_ledger"),
        ))
        .orderBy(reconciliationTransactions.id)
    : [];

  return { invoiceRows, forecastRows, accounts, openings, eventRows, snapshotRows, latestRun, liabilityRows };
}
