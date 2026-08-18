import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/src/db";
import {
  supplierInvoices,
  supplierInvoiceLines,
  budgetCategoryAccounts,
  chartOfAccounts,
} from "@/src/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { getOrCreateCompany } from "@/src/lib/db-helpers";

/**
 * Returns invoice lines from approved invoices whose accounting account
 * is not mapped to any budget category.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const year = searchParams.get("year");

  const company = await getOrCreateCompany();
  const db = getDb();

  // All account IDs that are mapped
  const mappings = await db.select().from(budgetCategoryAccounts);
  const mappedAccountIds = new Set(mappings.map((m) => m.accountId));

  // Approved invoices
  const invoices = await db
    .select({
      id: supplierInvoices.id,
      invoiceDate: supplierInvoices.invoiceDate,
      expenseAccountId: supplierInvoices.expenseAccountId,
    })
    .from(supplierInvoices)
    .where(
      and(
        eq(supplierInvoices.companyId, company.id),
        eq(supplierInvoices.status, "approved")
      )
    );

  if (!invoices.length) return NextResponse.json({ unmappedCount: 0, accounts: [] });

  const filteredInvoices = year
    ? invoices.filter((i) => i.invoiceDate && i.invoiceDate.startsWith(year))
    : invoices;

  const invoiceIds = filteredInvoices.map((i) => i.id);
  if (!invoiceIds.length) return NextResponse.json({ unmappedCount: 0, accounts: [] });

  const lines = await db
    .select()
    .from(supplierInvoiceLines)
    .where(inArray(supplierInvoiceLines.invoiceId, invoiceIds));

  // All COA codes for this company
  const coaRows = await db
    .select({ id: chartOfAccounts.id, code: chartOfAccounts.code, name: chartOfAccounts.name })
    .from(chartOfAccounts)
    .where(eq(chartOfAccounts.companyId, company.id));
  const coaCodeToId = new Map(coaRows.map((r) => [r.code, r.id]));
  const coaIdToInfo = new Map(coaRows.map((r) => [r.id, r]));

  const unmappedAccounts = new Map<number | string, { code: string; name: string; count: number }>();
  const invoiceMap = new Map(filteredInvoices.map((i) => [i.id, i]));

  for (const line of lines) {
    const inv = invoiceMap.get(line.invoiceId);
    if (!inv) continue;

    let resolvedId: number | null = null;
    if (line.accountingAccountNumber) {
      const id = coaCodeToId.get(line.accountingAccountNumber);
      if (id !== undefined) resolvedId = id;
    }
    if (resolvedId === null && inv.expenseAccountId) {
      resolvedId = inv.expenseAccountId;
    }

    if (resolvedId !== null && !mappedAccountIds.has(resolvedId)) {
      const info = coaIdToInfo.get(resolvedId);
      const key = resolvedId;
      const existing = unmappedAccounts.get(key);
      if (existing) {
        existing.count++;
      } else {
        unmappedAccounts.set(key, {
          code: info?.code ?? String(resolvedId),
          name: info?.name ?? "Unknown",
          count: 1,
        });
      }
    } else if (resolvedId === null && line.netAmount) {
      const key = "no-account";
      const existing = unmappedAccounts.get(key);
      if (existing) { existing.count++; } else {
        unmappedAccounts.set(key, { code: "—", name: "No account assigned", count: 1 });
      }
    }
  }

  const accounts = [...unmappedAccounts.values()];
  return NextResponse.json({
    unmappedCount: accounts.reduce((s, a) => s + a.count, 0),
    accounts,
  });
}
