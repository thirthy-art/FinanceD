import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/src/db";
import {
  budgetCategories,
  budgetCategoryAccounts,
  budgetEntries,
  budgetActualEntries,
  supplierInvoices,
  supplierInvoiceLines,
  chartOfAccounts,
} from "@/src/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { getOrCreateCompany } from "@/src/lib/db-helpers";
import { computeInvoiceActuals } from "@/src/lib/budget-actuals";
import { Decimal } from "@/src/lib/decimal";

function months(year: string): string[] {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
}

function d(v: string | null | undefined): Decimal {
  return new Decimal(v ?? "0");
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const year = searchParams.get("year");
  if (!year || !/^\d{4}$/.test(year))
    return NextResponse.json({ error: "year required (YYYY)" }, { status: 400 });

  const company = await getOrCreateCompany();
  const db = getDb();

  // 1. All active categories for company
  const cats = await db
    .select()
    .from(budgetCategories)
    .where(
      and(
        eq(budgetCategories.companyId, company.id),
        eq(budgetCategories.isActive, true)
      )
    )
    .orderBy(budgetCategories.sortOrder, budgetCategories.name);

  if (!cats.length) {
    return NextResponse.json({
      categories: [],
      months: months(year),
      baseCurrency: company.baseCurrency,
      unmappedCount: 0,
    });
  }

  const catIds = cats.map((c) => c.id);

  // 2. Budget entries for year
  const entries = await db
    .select()
    .from(budgetEntries)
    .where(
      and(
        eq(budgetEntries.companyId, company.id),
        inArray(budgetEntries.budgetCategoryId, catIds)
      )
    );
  const budgetYearEntries = entries.filter((e) => e.month.startsWith(year));

  // 3. Manual actual entries for year
  const manualActuals = await db
    .select()
    .from(budgetActualEntries)
    .where(
      and(
        eq(budgetActualEntries.companyId, company.id),
        inArray(budgetActualEntries.budgetCategoryId, catIds)
      )
    );
  const manualYearActuals = manualActuals.filter((e) => e.month.startsWith(year));

  // 4. Account→category mapping
  const mappings = await db
    .select()
    .from(budgetCategoryAccounts)
    .where(inArray(budgetCategoryAccounts.budgetCategoryId, catIds));
  const accountToCategoryId = new Map<number, number>();
  for (const m of mappings) {
    accountToCategoryId.set(m.accountId, m.budgetCategoryId);
  }
  const mappedAccountIds = mappings.map((m) => m.accountId);

  // 5. Approved supplier invoices for this company
  const invoices = await db
    .select({
      id: supplierInvoices.id,
      invoiceDate: supplierInvoices.invoiceDate,
      fxRateToBase: supplierInvoices.fxRateToBase,
      expenseAccountId: supplierInvoices.expenseAccountId,
    })
    .from(supplierInvoices)
    .where(
      and(
        eq(supplierInvoices.companyId, company.id),
        eq(supplierInvoices.status, "approved")
      )
    );

  // 6. Invoice lines for those invoices
  let invoiceActualLines: {
    invoiceId: number;
    netAmount: string | null;
    fxRateToBase: string | null;
    invoiceDate: string | null;
    recognitionTreatment: "Immediate" | "Prepaid";
    recognitionStartDate: string | null;
    recognitionEndDate: string | null;
    budgetCategoryId: number;
  }[] = [];

  // Track unmapped invoice line amounts
  let unmappedCount = 0;

  if (invoices.length && mappedAccountIds.length) {
    const invoiceIds = invoices.map((i) => i.id);
    const invoiceMap = new Map(invoices.map((i) => [i.id, i]));

    const lines = await db
      .select()
      .from(supplierInvoiceLines)
      .where(inArray(supplierInvoiceLines.invoiceId, invoiceIds));

    // Build COA code→id map for accounts that are mapped
    let coaCodeToId = new Map<string, number>();
    if (mappedAccountIds.length) {
      const coaRows = await db
        .select({ id: chartOfAccounts.id, code: chartOfAccounts.code })
        .from(chartOfAccounts)
        .where(
          and(
            eq(chartOfAccounts.companyId, company.id),
            inArray(chartOfAccounts.id, mappedAccountIds)
          )
        );
      for (const r of coaRows) coaCodeToId.set(r.code, r.id);
    }

    for (const line of lines) {
      const inv = invoiceMap.get(line.invoiceId)!;

      // Resolve account: line accountingAccountNumber → COA id, else invoice expenseAccountId
      let resolvedAccountId: number | null = null;
      if (line.accountingAccountNumber) {
        const id = coaCodeToId.get(line.accountingAccountNumber);
        if (id !== undefined) resolvedAccountId = id;
      }
      if (resolvedAccountId === null && inv.expenseAccountId) {
        if (accountToCategoryId.has(inv.expenseAccountId)) {
          resolvedAccountId = inv.expenseAccountId;
        }
      }

      if (resolvedAccountId === null || !accountToCategoryId.has(resolvedAccountId)) {
        // Count as unmapped if the line has a net amount
        if (line.netAmount && d(line.netAmount).gt(0)) unmappedCount++;
        continue;
      }

      const budgetCategoryId = accountToCategoryId.get(resolvedAccountId)!;

      invoiceActualLines.push({
        invoiceId: line.invoiceId,
        netAmount: line.netAmount,
        fxRateToBase: inv.fxRateToBase,
        invoiceDate: inv.invoiceDate,
        recognitionTreatment: line.recognitionTreatment,
        recognitionStartDate: line.recognitionStartDate,
        recognitionEndDate: line.recognitionEndDate,
        budgetCategoryId,
      });
    }
  } else if (invoices.length) {
    // Count unmapped — invoices exist but no account mappings set up
    unmappedCount = invoices.length;
  }

  // 7. Compute invoice actuals via recognition schedule
  const invoiceActualMap = computeInvoiceActuals(invoiceActualLines, year);

  // 8. Build result per category/month
  const allMonths = months(year);

  const categoryResults = cats.map((cat) => {
    const monthData: Record<string, {
      budget: string;
      invoiceActual: string;
      manualActual: string;
      actual: string;
      variance: string;
    }> = {};

    for (const month of allMonths) {
      const budget = budgetYearEntries
        .filter((e) => e.budgetCategoryId === cat.id && e.month === month)
        .reduce((acc, e) => acc.plus(e.amount ?? "0"), new Decimal(0));

      const invoiceActual = invoiceActualMap.get(`${cat.id}:${month}`) ?? new Decimal(0);

      const manualActual = manualYearActuals
        .filter((e) => e.budgetCategoryId === cat.id && e.month === month)
        .reduce((acc, e) => acc.plus(e.amount ?? "0"), new Decimal(0));

      const actual = invoiceActual.plus(manualActual);
      const variance = budget.minus(actual);

      monthData[month] = {
        budget: budget.toFixed(2),
        invoiceActual: invoiceActual.toFixed(2),
        manualActual: manualActual.toFixed(2),
        actual: actual.toFixed(2),
        variance: variance.toFixed(2),
      };
    }

    return {
      id: cat.id,
      name: cat.name,
      isActive: cat.isActive,
      months: monthData,
    };
  });

  return NextResponse.json({
    categories: categoryResults,
    months: allMonths,
    baseCurrency: company.baseCurrency,
    unmappedCount,
  });
}
