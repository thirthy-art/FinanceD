import { describe, it, expect } from "vitest";
import {
  computeInvoiceActuals,
  isValidMonth,
  resolveLineCategory,
  resolveBudgetForMonth,
  type InvoiceLineForBudget,
  type BudgetEntrySlim,
} from "@/src/lib/budget-actuals";
import { Decimal } from "@/src/lib/decimal";

// ─── Month validation ─────────────────────────────────────────────────────────

describe("isValidMonth", () => {
  it("accepts valid YYYY-MM values", () => {
    expect(isValidMonth("2026-08")).toBe(true);
    expect(isValidMonth("2026-01")).toBe(true);
    expect(isValidMonth("2026-12")).toBe(true);
  });

  it("rejects invalid formats", () => {
    expect(isValidMonth("2026-0")).toBe(false);
    expect(isValidMonth("2026-13")).toBe(false);
    expect(isValidMonth("2026-00")).toBe(false);
    expect(isValidMonth("26-08")).toBe(false);
    expect(isValidMonth("2026/08")).toBe(false);
    expect(isValidMonth("")).toBe(false);
    expect(isValidMonth("2026-08-01")).toBe(false);
  });
});

// ─── Budget arithmetic ────────────────────────────────────────────────────────

describe("budget arithmetic", () => {
  it("variance = budget - actual (favorable positive)", () => {
    const budget = new Decimal("50000");
    const actual = new Decimal("44000");
    const variance = budget.minus(actual);
    expect(variance.toFixed(2)).toBe("6000.00");
    expect(variance.gt(0)).toBe(true);
  });

  it("variance = budget - actual (unfavorable negative)", () => {
    const budget = new Decimal("10000");
    const actual = new Decimal("12000");
    const variance = budget.minus(actual);
    expect(variance.toFixed(2)).toBe("-2000.00");
    expect(variance.lt(0)).toBe(true);
  });

  it("actual = invoice actual + manual actual", () => {
    const invoiceActual = new Decimal("1500");
    const manualActual = new Decimal("42500");
    const total = invoiceActual.plus(manualActual);
    expect(total.toFixed(2)).toBe("44000.00");
  });
});

// ─── Invoice actuals: approved only ──────────────────────────────────────────

describe("computeInvoiceActuals – approved invoice flag is enforced by caller", () => {
  // The API only fetches approved invoices before passing to computeInvoiceActuals.
  // We verify the function itself works with provided lines, not that it filters drafts
  // (draft filtering is an API concern).

  it("includes lines passed to it", () => {
    const lines: InvoiceLineForBudget[] = [
      {
        invoiceId: 1,
        netAmount: "1000.00",
        fxRateToBase: "1",
        invoiceDate: "2026-08-10",
        recognitionTreatment: "Immediate",
        recognitionStartDate: null,
        recognitionEndDate: null,
        budgetCategoryId: 5,
      },
    ];
    const map = computeInvoiceActuals(lines, "2026");
    expect(map.get("5:2026-08")?.toFixed(2)).toBe("1000.00");
  });

  it("produces no output for empty input (draft scenario simulation)", () => {
    const map = computeInvoiceActuals([], "2026");
    expect(map.size).toBe(0);
  });
});

// ─── Immediate expense recognition ───────────────────────────────────────────

describe("computeInvoiceActuals – Immediate treatment", () => {
  it("places full amount in invoice month", () => {
    const lines: InvoiceLineForBudget[] = [
      {
        invoiceId: 10,
        netAmount: "3000.00",
        fxRateToBase: "1",
        invoiceDate: "2026-03-15",
        recognitionTreatment: "Immediate",
        recognitionStartDate: null,
        recognitionEndDate: null,
        budgetCategoryId: 2,
      },
    ];
    const map = computeInvoiceActuals(lines, "2026");
    expect(map.get("2:2026-03")?.toFixed(2)).toBe("3000.00");
    expect(map.size).toBe(1);
  });

  it("filters by year – expense in different year not included", () => {
    const lines: InvoiceLineForBudget[] = [
      {
        invoiceId: 11,
        netAmount: "500.00",
        fxRateToBase: "1",
        invoiceDate: "2025-12-20",
        recognitionTreatment: "Immediate",
        recognitionStartDate: null,
        recognitionEndDate: null,
        budgetCategoryId: 3,
      },
    ];
    const map = computeInvoiceActuals(lines, "2026");
    expect(map.size).toBe(0);
  });
});

// ─── Prepaid recognition ──────────────────────────────────────────────────────

describe("computeInvoiceActuals – Prepaid treatment", () => {
  it("spreads amount across recognition months", () => {
    const lines: InvoiceLineForBudget[] = [
      {
        invoiceId: 20,
        netAmount: "1200.00",
        fxRateToBase: "1",
        invoiceDate: "2025-12-01",
        recognitionTreatment: "Prepaid",
        recognitionStartDate: "2026-01-01",
        recognitionEndDate: "2026-04-30",
        budgetCategoryId: 7,
      },
    ];
    const map = computeInvoiceActuals(lines, "2026");
    // 1200 / 4 months = 300 each
    expect(map.get("7:2026-01")?.toFixed(2)).toBe("300.00");
    expect(map.get("7:2026-02")?.toFixed(2)).toBe("300.00");
    expect(map.get("7:2026-03")?.toFixed(2)).toBe("300.00");
    expect(map.get("7:2026-04")?.toFixed(2)).toBe("300.00");
    expect(map.get("7:2026-05")).toBeUndefined();
  });

  it("rounding residual handled correctly across months", () => {
    // 100 / 3 = 33.33... last month gets residual
    const lines: InvoiceLineForBudget[] = [
      {
        invoiceId: 21,
        netAmount: "100.00",
        fxRateToBase: "1",
        invoiceDate: "2026-01-01",
        recognitionTreatment: "Prepaid",
        recognitionStartDate: "2026-01-01",
        recognitionEndDate: "2026-03-31",
        budgetCategoryId: 8,
      },
    ];
    const map = computeInvoiceActuals(lines, "2026");
    const jan = map.get("8:2026-01")!;
    const feb = map.get("8:2026-02")!;
    const mar = map.get("8:2026-03")!;
    const total = jan.plus(feb).plus(mar);
    expect(total.toFixed(2)).toBe("100.00");
  });

  it("prepaid crossing year boundary – only current year months included when filtered", () => {
    const lines: InvoiceLineForBudget[] = [
      {
        invoiceId: 22,
        netAmount: "240.00",
        fxRateToBase: "1",
        invoiceDate: "2025-11-01",
        recognitionTreatment: "Prepaid",
        recognitionStartDate: "2025-11-01",
        recognitionEndDate: "2026-02-28",
        budgetCategoryId: 9,
      },
    ];
    // 240 / 4 months = 60 each. 2025-11 and 2025-12 filtered out.
    const map = computeInvoiceActuals(lines, "2026");
    expect(map.get("9:2026-01")?.toFixed(2)).toBe("60.00");
    expect(map.get("9:2026-02")?.toFixed(2)).toBe("60.00");
    expect(map.get("9:2025-11")).toBeUndefined();
    expect(map.get("9:2025-12")).toBeUndefined();
  });
});

// ─── Base currency / FX ───────────────────────────────────────────────────────

describe("computeInvoiceActuals – base currency conversion", () => {
  it("applies FX rate: USD 1000 at 0.92 EUR/USD → 920 EUR base", () => {
    const lines: InvoiceLineForBudget[] = [
      {
        invoiceId: 30,
        netAmount: "1000.00",
        fxRateToBase: "0.92",
        invoiceDate: "2026-06-10",
        recognitionTreatment: "Immediate",
        recognitionStartDate: null,
        recognitionEndDate: null,
        budgetCategoryId: 4,
      },
    ];
    const map = computeInvoiceActuals(lines, "2026");
    expect(map.get("4:2026-06")?.toFixed(2)).toBe("920.00");
  });

  it("no FX rate defaults to 1:1", () => {
    const lines: InvoiceLineForBudget[] = [
      {
        invoiceId: 31,
        netAmount: "500.00",
        fxRateToBase: null,
        invoiceDate: "2026-05-01",
        recognitionTreatment: "Immediate",
        recognitionStartDate: null,
        recognitionEndDate: null,
        budgetCategoryId: 4,
      },
    ];
    const map = computeInvoiceActuals(lines, "2026");
    expect(map.get("4:2026-05")?.toFixed(2)).toBe("500.00");
  });
});

// ─── Manual actual included in total ─────────────────────────────────────────

describe("manual actuals combined with invoice actuals", () => {
  it("sums both sources for total actual", () => {
    const invoiceActual = new Decimal("1500.00");
    const manualActual = new Decimal("42500.00");
    const total = invoiceActual.plus(manualActual);
    const budget = new Decimal("50000.00");
    const variance = budget.minus(total);
    expect(total.toFixed(2)).toBe("44000.00");
    expect(variance.toFixed(2)).toBe("6000.00");
  });

  it("multiple invoice lines for same category/month are accumulated", () => {
    const lines: InvoiceLineForBudget[] = [
      {
        invoiceId: 40,
        netAmount: "800.00",
        fxRateToBase: "1",
        invoiceDate: "2026-07-05",
        recognitionTreatment: "Immediate",
        recognitionStartDate: null,
        recognitionEndDate: null,
        budgetCategoryId: 6,
      },
      {
        invoiceId: 41,
        netAmount: "200.00",
        fxRateToBase: "1",
        invoiceDate: "2026-07-20",
        recognitionTreatment: "Immediate",
        recognitionStartDate: null,
        recognitionEndDate: null,
        budgetCategoryId: 6,
      },
    ];
    const map = computeInvoiceActuals(lines, "2026");
    expect(map.get("6:2026-07")?.toFixed(2)).toBe("1000.00");
  });
});

// ─── Unmapped account excluded ────────────────────────────────────────────────

describe("unmapped accounts excluded from actuals", () => {
  it("line with no category mapping produces no output", () => {
    // In the real code, lines are only passed to computeInvoiceActuals
    // after the account→category lookup. An unmapped account simply never
    // gets a budgetCategoryId assigned, so it never reaches this function.
    // Here we verify that an empty lines array (as the API would produce
    // for unmapped accounts) results in zero actuals.
    const lines: InvoiceLineForBudget[] = [];
    const map = computeInvoiceActuals(lines, "2026");
    expect(map.size).toBe(0);
  });

  it("two lines: one mapped, one not – only mapped produces output", () => {
    // Simulate: the API only passes the mapped line to computeInvoiceActuals
    const mappedLines: InvoiceLineForBudget[] = [
      {
        invoiceId: 50,
        netAmount: "600.00",
        fxRateToBase: "1",
        invoiceDate: "2026-09-01",
        recognitionTreatment: "Immediate",
        recognitionStartDate: null,
        recognitionEndDate: null,
        budgetCategoryId: 11,
      },
      // The unmapped line is excluded by the caller (API route) — not passed here
    ];
    const map = computeInvoiceActuals(mappedLines, "2026");
    expect(map.get("11:2026-09")?.toFixed(2)).toBe("600.00");
    expect(map.size).toBe(1);
  });
});

// ─── resolveLineCategory: account precedence regression ──────────────────────

describe("resolveLineCategory", () => {
  const coaCodeToId = new Map([
    ["4000", 10],
    ["5000", 20],
  ]);
  const accountToCategoryId = new Map([
    [10, 100], // COA id 10 → category 100
    [20, 200], // COA id 20 → category 200
  ]);

  it("uses accountingAccountNumber when present and resolves category", () => {
    const result = resolveLineCategory("4000", 20, coaCodeToId, accountToCategoryId);
    expect(result).toBe(100); // resolves via "4000" → id 10 → cat 100, NOT via fallback 20
  });

  it("regression: non-blank accountingAccountNumber NOT in COA → null (no fallback to expenseAccountId)", () => {
    // "9999" is not in coaCodeToId. Even though fallbackAccountId=20 maps to category 200,
    // the fallback must NOT be used — the correct result is null (unmapped).
    const result = resolveLineCategory("9999", 20, coaCodeToId, accountToCategoryId);
    expect(result).toBeNull();
  });

  it("blank accountingAccountNumber falls back to expenseAccountId", () => {
    const result = resolveLineCategory(null, 20, coaCodeToId, accountToCategoryId);
    expect(result).toBe(200);
  });

  it("both null → null", () => {
    const result = resolveLineCategory(null, null, coaCodeToId, accountToCategoryId);
    expect(result).toBeNull();
  });

  it("accountingAccountNumber present but account not mapped to any category → null", () => {
    const coaWithUnmapped = new Map([["6000", 30]]);
    const result = resolveLineCategory("6000", 20, coaWithUnmapped, accountToCategoryId);
    expect(result).toBeNull();
  });
});

// ─── resolveBudgetForMonth: double-counting prevention ───────────────────────

describe("resolveBudgetForMonth", () => {
  it("company-level (null CC) entry takes exclusive precedence over CC entries", () => {
    const entries: BudgetEntrySlim[] = [
      { budgetCategoryId: 1, month: "2026-08", costCentreId: null, amount: "50000" },
      { budgetCategoryId: 1, month: "2026-08", costCentreId: 10, amount: "20000" },
      { budgetCategoryId: 1, month: "2026-08", costCentreId: 11, amount: "30000" },
    ];
    const result = resolveBudgetForMonth(entries, 1, "2026-08");
    expect(result.toFixed(2)).toBe("50000.00"); // not 100000 (no double-counting)
  });

  it("when no company-level entry exists, sums cost-centre entries", () => {
    const entries: BudgetEntrySlim[] = [
      { budgetCategoryId: 1, month: "2026-08", costCentreId: 10, amount: "20000" },
      { budgetCategoryId: 1, month: "2026-08", costCentreId: 11, amount: "30000" },
    ];
    const result = resolveBudgetForMonth(entries, 1, "2026-08");
    expect(result.toFixed(2)).toBe("50000.00");
  });

  it("returns zero when no entries exist for the category/month", () => {
    const result = resolveBudgetForMonth([], 1, "2026-08");
    expect(result.toFixed(2)).toBe("0.00");
  });

  it("only considers entries matching the given catId and month", () => {
    const entries: BudgetEntrySlim[] = [
      { budgetCategoryId: 1, month: "2026-08", costCentreId: null, amount: "50000" },
      { budgetCategoryId: 2, month: "2026-08", costCentreId: null, amount: "9000" },
      { budgetCategoryId: 1, month: "2026-09", costCentreId: null, amount: "8000" },
    ];
    expect(resolveBudgetForMonth(entries, 1, "2026-08").toFixed(2)).toBe("50000.00");
    expect(resolveBudgetForMonth(entries, 2, "2026-08").toFixed(2)).toBe("9000.00");
    expect(resolveBudgetForMonth(entries, 1, "2026-09").toFixed(2)).toBe("8000.00");
  });
});
