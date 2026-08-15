import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { chartOfAccounts } from "./schema";

export const CLEANING_ACCOUNT_SEED = [
  { code: "640", name: "Operational Expenses", isPosting: false, parentCode: null },
  { code: "6430", name: "Office Admin. Costs", isPosting: false, parentCode: "640" },
  { code: "64300", name: "Office Admin. Costs", isPosting: false, parentCode: "6430" },
  { code: "643070", name: "Cleaning Expenses", isPosting: true, parentCode: "64300" },
  { code: "643140", name: "Cleaning Supplies", isPosting: true, parentCode: "64300" },
] as const;

export async function seedCleaningAccounts(db: NodePgDatabase<typeof schema>, companyId: number) {
  const accountIds = new Map<string, number>();

  for (const account of CLEANING_ACCOUNT_SEED) {
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
        type: "expense",
        isActive: true,
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
