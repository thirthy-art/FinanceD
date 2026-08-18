import { Decimal } from "./decimal";
import { deriveRecognitionSchedule } from "./recognition";

export interface InvoiceLineForBudget {
  invoiceId: number;
  netAmount: string | null | undefined;
  fxRateToBase: string | null | undefined;
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
