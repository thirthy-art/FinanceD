import { Decimal } from "./decimal";
import { deriveRecognitionSchedule } from "./recognition";

export interface InvoiceLineForBudget {
  invoiceId: number;
  netAmount: string | null | undefined;
  fxRateToBase: string | null | undefined;
  currencyType?: "fiat" | "crypto";
  invoiceDate: string | null | undefined;
  recognitionTreatment: "Immediate" | "Prepaid";
  recognitionStartDate: string | null | undefined;
  recognitionEndDate: string | null | undefined;
  budgetCategoryId: number;
}

/**
 * Computes recognized invoice actuals per category/month using the existing
 * deriveRecognitionSchedule logic. Only approved invoices should be passed in.
 *
 * Returns a Map keyed by `${categoryId}:${month}` with Decimal totals in base currency.
 */
export function computeInvoiceActuals(
  lines: InvoiceLineForBudget[],
  filterYear?: string
): Map<string, Decimal> {
  const result = new Map<string, Decimal>();

  for (const line of lines) {
    const schedule = deriveRecognitionSchedule({
      netAmount: line.netAmount,
      fxRate: line.fxRateToBase,
      currencyType: line.currencyType,
      treatment: line.recognitionTreatment,
      invoiceDate: line.invoiceDate,
      startDate: line.recognitionStartDate,
      endDate: line.recognitionEndDate,
    });

    for (const row of schedule) {
      if (filterYear && !row.month.startsWith(filterYear)) continue;
      const key = `${line.budgetCategoryId}:${row.month}`;
      const prev = result.get(key) ?? new Decimal(0);
      result.set(key, prev.plus(row.baseAmount));
    }
  }

  return result;
}

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isValidMonth(m: string): boolean {
  return MONTH_RE.test(m);
}

/**
 * Resolves which budget category a supplier invoice line belongs to.
 *
 * Precedence rule (fix for fallback bug):
 *  - If line.accountingAccountNumber is non-blank, use that code exclusively:
 *    resolve it in COA, find its category, and stop. Never fall back to
 *    the invoice-level expenseAccountId in this case.
 *  - Only when accountingAccountNumber is blank may expenseAccountId be used.
 *
 * coaCodeToId: company's full COA code→id map (need not be limited to mapped accounts).
 * accountToCategoryId: budget_category_accounts account_id→budget_category_id map.
 *
 * Returns the resolved budgetCategoryId, or null if unmapped/unresolvable.
 */
export function resolveLineCategory(
  lineAccountNumber: string | null | undefined,
  fallbackAccountId: number | null | undefined,
  coaCodeToId: Map<string, number>,
  accountToCategoryId: Map<number, number>
): number | null {
  if (lineAccountNumber) {
    // accountingAccountNumber is present — no fallback allowed
    const accountId = coaCodeToId.get(lineAccountNumber);
    if (accountId === undefined) return null; // code not in COA → unmapped
    return accountToCategoryId.get(accountId) ?? null; // in COA but not mapped → unmapped
  }
  // accountingAccountNumber is blank — may use fallback
  if (fallbackAccountId != null) {
    return accountToCategoryId.get(fallbackAccountId) ?? null;
  }
  return null;
}

export interface BudgetEntrySlim {
  budgetCategoryId: number;
  month: string;
  costCentreId: number | null;
  amount: string | null;
}

/**
 * Returns the budget amount for a category/month applying the V1 double-counting rule:
 *  - If a company-level entry (costCentreId = null) exists, it IS the company total.
 *    Cost-centre-specific entries for the same cat/month are NOT added to it.
 *  - If no company-level entry exists, sum all cost-centre-specific entries.
 */
export function resolveBudgetForMonth(
  entries: BudgetEntrySlim[],
  catId: number,
  month: string
): Decimal {
  const scoped = entries.filter(
    (e) => e.budgetCategoryId === catId && e.month === month
  );
  const companyLevel = scoped.find((e) => e.costCentreId === null);
  if (companyLevel) {
    return new Decimal(companyLevel.amount ?? "0");
  }
  return scoped.reduce(
    (acc, e) => acc.plus(e.amount ?? "0"),
    new Decimal(0)
  );
}
