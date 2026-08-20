import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/src/db";
import {
  supplierInvoices,
  supplierInvoiceLines,
  budgetCategoryAccounts,
  budgetCategories,
  chartOfAccounts,
} from "@/src/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { getActiveCompanyFromRequest } from "@/src/lib/active-company";

/**
 * Returns invoice lines from approved invoices whose accounting account
 * is not mapped to any budget category.
 *
 * Account resolution precedence (consistent with report route):
 *  - If line.accountingAccountNumber is non-blank, use only that code.
 *    No fallback to invoice.expenseAccountId.
 *  - Only when accountingAccountNumber is blank may expenseAccountId be used.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const year = searchParams.get("year");

  const company = await getActiveCompanyFromRequest(req);
  if (company instanceof Response) return company;
  const db = getDb();

  // Account IDs mapped to an ACTIVE budget category for this company.
  // Mappings to inactive categories are treated as unmapped (consistent with report route).
  const mappings = await db
    .select({ accountId: budgetCategoryAccounts.accountId })
    .from(budgetCategoryAccounts)
    .innerJoin(
      budgetCategories,
      and(
        eq(budgetCategoryAccounts.budgetCategoryId, budgetCategories.id),
        eq(budgetCategories.companyId, company.id),
        eq(budgetCategories.isActive, true)
      )
    );
  const mappedAccountIds = new Set(mappings.map((m) => m.accountId));

  // Approved invoices for this company
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

  // Company-wide COA map
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

    // Correct precedence: if accountingAccountNumber is present, use it exclusively.
    // Do NOT fall back to expenseAccountId when accountingAccountNumber is set.
    let resolvedId: number | null = null;
    let stopFallback = false;

    if (line.accountingAccountNumber) {
      stopFallback = true;
      const id = coaCodeToId.get(line.accountingAccountNumber);
      if (id !== undefined) resolvedId = id;
      // If not found in COA, resolvedId stays null → treated as unmapped below
    }

    if (!stopFallback && inv.expenseAccountId != null) {
      resolvedId = inv.expenseAccountId;
    }

    if (resolvedId !== null && mappedAccountIds.has(resolvedId)) {
      // This line is mapped — skip it (not unmapped)
      continue;
    }

    if (resolvedId !== null) {
      // Resolved to an account but not mapped
      const info = coaIdToInfo.get(resolvedId);
      const existing = unmappedAccounts.get(resolvedId);
      if (existing) {
        existing.count++;
      } else {
        unmappedAccounts.set(resolvedId, {
          code: info?.code ?? String(resolvedId),
          name: info?.name ?? "Unknown",
          count: 1,
        });
      }
    } else if (line.netAmount) {
      // No account could be determined
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
