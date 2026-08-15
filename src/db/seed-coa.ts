import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { chartOfAccounts } from "./schema";

export const EXPENSE_ACCOUNT_SEED = [
  { code: "500", name: "Direct Trading Costs", parentCode: null, type: "expense", isActive: true, isPosting: false },
  { code: "5000", name: "Direct Trading Costs", parentCode: "500", type: "expense", isActive: true, isPosting: false },
  { code: "50000", name: "Direct Trading Costs", parentCode: "5000", type: "expense", isActive: true, isPosting: false },
  { code: "520", name: "Partnership Expenses", parentCode: null, type: "expense", isActive: true, isPosting: false },
  { code: "5200", name: "Affiliate-IB Costs", parentCode: "520", type: "expense", isActive: true, isPosting: false },
  { code: "52000", name: "Affiliate-IB Costs", parentCode: "5200", type: "expense", isActive: true, isPosting: false },
  { code: "600", name: "Online Marketing Expenses", parentCode: null, type: "expense", isActive: true, isPosting: false },
  { code: "6000", name: "Online Marketing Expenses", parentCode: "600", type: "expense", isActive: true, isPosting: false },
  { code: "60000", name: "Online Marketing Expenses", parentCode: "6000", type: "expense", isActive: true, isPosting: false },
  { code: "610", name: "Offline Marketing Expenses", parentCode: null, type: "expense", isActive: true, isPosting: false },
  { code: "6100", name: "Offline Marketing Expenses", parentCode: "610", type: "expense", isActive: true, isPosting: false },
  { code: "61000", name: "Offline Marketing Expenses", parentCode: "6100", type: "expense", isActive: true, isPosting: false },
  { code: "620", name: "HR Expenses", parentCode: null, type: "expense", isActive: true, isPosting: false },
  { code: "6200", name: "Payroll", parentCode: "620", type: "expense", isActive: true, isPosting: false },
  { code: "62000", name: "Salaries", parentCode: "6200", type: "expense", isActive: true, isPosting: false },
  { code: "62010", name: "Subcontractors", parentCode: "6200", type: "expense", isActive: true, isPosting: false },
  { code: "6210", name: "Staff Costs", parentCode: "620", type: "expense", isActive: true, isPosting: false },
  { code: "62100", name: "Staff Costs", parentCode: "6210", type: "expense", isActive: true, isPosting: false },
  { code: "630", name: "IT Expenses", parentCode: null, type: "expense", isActive: true, isPosting: false },
  { code: "6300", name: "Telecommunications", parentCode: "630", type: "expense", isActive: true, isPosting: false },
  { code: "63000", name: "Telecommunications", parentCode: "6300", type: "expense", isActive: true, isPosting: false },
  { code: "6310", name: "Licenses & Tech Support", parentCode: "630", type: "expense", isActive: true, isPosting: false },
  { code: "63100", name: "Licenses & Tech Support", parentCode: "6310", type: "expense", isActive: true, isPosting: false },
  { code: "6320", name: "Other IT Costs", parentCode: "630", type: "expense", isActive: true, isPosting: false },
  { code: "63200", name: "Other IT Costs", parentCode: "6320", type: "expense", isActive: true, isPosting: false },
  { code: "640", name: "Operational Expenses", parentCode: null, type: "expense", isActive: true, isPosting: false },
  { code: "6400", name: "Travelling & Entertainment", parentCode: "640", type: "expense", isActive: true, isPosting: false },
  { code: "64000", name: "Travelling & Entertainment", parentCode: "6400", type: "expense", isActive: true, isPosting: false },
  { code: "6430", name: "Office Admin. Costs", parentCode: "640", type: "expense", isActive: true, isPosting: false },
  { code: "64300", name: "Office Admin. Costs", parentCode: "6430", type: "expense", isActive: true, isPosting: false },
  { code: "643070", name: "Cleaning Expenses", parentCode: "64300", type: "expense", isActive: true, isPosting: true },
  { code: "643140", name: "Cleaning Supplies", parentCode: "64300", type: "expense", isActive: true, isPosting: true },
  { code: "6440", name: "Insurances", parentCode: "640", type: "expense", isActive: true, isPosting: false },
  { code: "64400", name: "Insurances", parentCode: "6440", type: "expense", isActive: true, isPosting: false },
  { code: "6450", name: "Depreciation", parentCode: "640", type: "expense", isActive: true, isPosting: false },
  { code: "64500", name: "Depreciation", parentCode: "6450", type: "expense", isActive: true, isPosting: false },
  { code: "6460", name: "Other Expenses", parentCode: "640", type: "expense", isActive: true, isPosting: false },
  { code: "64600", name: "Other Expenses", parentCode: "6460", type: "expense", isActive: true, isPosting: false },
  { code: "650", name: "Professional Expenses", parentCode: null, type: "expense", isActive: true, isPosting: false },
  { code: "6500", name: "Professional Fees", parentCode: "650", type: "expense", isActive: true, isPosting: false },
  { code: "65000", name: "Professional Fees", parentCode: "6500", type: "expense", isActive: true, isPosting: false },
  { code: "6550", name: "Other Professional Services", parentCode: "650", type: "expense", isActive: true, isPosting: false },
  { code: "65500", name: "Other Professional Services", parentCode: "6550", type: "expense", isActive: true, isPosting: false },
  { code: "700", name: "Finance Income and Expenses", parentCode: null, type: "expense", isActive: true, isPosting: false },
  { code: "7010", name: "Finance Expenses", parentCode: "700", type: "expense", isActive: true, isPosting: false },
  { code: "70100", name: "Finance Expenses", parentCode: "7010", type: "expense", isActive: true, isPosting: false },
  { code: "7020", name: "Exchange Rate Difference", parentCode: "700", type: "expense", isActive: true, isPosting: false },
  { code: "70200", name: "Client TB", parentCode: "7020", type: "expense", isActive: true, isPosting: false },
  { code: "70210", name: "Legal TB", parentCode: "7020", type: "expense", isActive: true, isPosting: false },
  { code: "800", name: "Taxation", parentCode: null, type: "expense", isActive: true, isPosting: false },
  { code: "8000", name: "Taxation", parentCode: "800", type: "expense", isActive: true, isPosting: false },
  { code: "80000", name: "Taxation", parentCode: "8000", type: "expense", isActive: true, isPosting: false },
] as const;

export async function seedExpenseAccounts(db: NodePgDatabase<typeof schema>, companyId: number) {
  const accountIds = new Map<string, number>();

  for (const account of EXPENSE_ACCOUNT_SEED) {
    const [existing] = await db
      .select({ id: chartOfAccounts.id })
      .from(chartOfAccounts)
      .where(and(eq(chartOfAccounts.companyId, companyId), eq(chartOfAccounts.code, account.code)))
      .limit(1);

    if (existing) {
      accountIds.set(account.code, existing.id);
      continue;
    }

    const parentId = account.parentCode ? accountIds.get(account.parentCode) ?? null : null;
    const [inserted] = await db
      .insert(chartOfAccounts)
      .values({
        companyId,
        code: account.code,
        name: account.name,
        type: account.type,
        isActive: account.isActive,
        isPosting: account.isPosting,
        parentId,
      })
      .onConflictDoNothing({ target: [chartOfAccounts.companyId, chartOfAccounts.code] })
      .returning({ id: chartOfAccounts.id });

    if (inserted) {
      accountIds.set(account.code, inserted.id);
      continue;
    }

    const [concurrent] = await db
      .select({ id: chartOfAccounts.id })
      .from(chartOfAccounts)
      .where(and(eq(chartOfAccounts.companyId, companyId), eq(chartOfAccounts.code, account.code)))
      .limit(1);
    if (concurrent) accountIds.set(account.code, concurrent.id);
  }
}
