import { describe, expect, it } from "vitest";
import {
  classifyBucket,
  isFundingThroughMonthEnd,
  sumByCurrency,
  getWeekDateRange,
} from "@/src/lib/cash-flow-buckets";

const TODAY = "2026-08-17";

describe("classifyBucket", () => {
  it("classifies a due date before today as overdue", () => {
    expect(classifyBucket("2026-08-16", TODAY)).toBe("overdue");
  });

  it("classifies due date in the distant past as overdue", () => {
    expect(classifyBucket("2025-01-01", TODAY)).toBe("overdue");
  });

  it("classifies today's due date as week1", () => {
    expect(classifyBucket("2026-08-17", TODAY)).toBe("week1");
  });

  it("classifies last day of week 1 (today+6) as week1", () => {
    expect(classifyBucket("2026-08-23", TODAY)).toBe("week1");
  });

  it("classifies first day of week 2 (today+7) as week2", () => {
    expect(classifyBucket("2026-08-24", TODAY)).toBe("week2");
  });

  it("classifies last day of week 2 (today+13) as week2", () => {
    expect(classifyBucket("2026-08-30", TODAY)).toBe("week2");
  });

  it("classifies first day of week 3 (today+14) as week3", () => {
    expect(classifyBucket("2026-08-31", TODAY)).toBe("week3");
  });

  it("classifies last day of week 3 (today+20) as week3", () => {
    expect(classifyBucket("2026-09-06", TODAY)).toBe("week3");
  });

  it("classifies first day of week 4 (today+21) as week4", () => {
    expect(classifyBucket("2026-09-07", TODAY)).toBe("week4");
  });

  it("classifies last day of week 4 (today+27) as week4", () => {
    expect(classifyBucket("2026-09-13", TODAY)).toBe("week4");
  });

  it("classifies today+28 as later", () => {
    expect(classifyBucket("2026-09-14", TODAY)).toBe("later");
  });

  it("classifies a far future date as later", () => {
    expect(classifyBucket("2027-06-01", TODAY)).toBe("later");
  });

  it("classifies null as missing", () => {
    expect(classifyBucket(null, TODAY)).toBe("missing");
  });

  it("classifies undefined as missing", () => {
    expect(classifyBucket(undefined, TODAY)).toBe("missing");
  });

  it("classifies empty string as missing", () => {
    expect(classifyBucket("", TODAY)).toBe("missing");
  });

  it("classifies an invalid date string as missing", () => {
    expect(classifyBucket("not-a-date", TODAY)).toBe("missing");
  });

  it("does not include Paid invoice — caller responsibility (bucket logic is agnostic)", () => {
    // Paid invoices should be filtered before classifyBucket is called.
    // Here we confirm the bucket is still classified — filtering happens upstream.
    expect(classifyBucket("2026-08-20", TODAY)).toBe("week1");
  });

  it("handles month boundary correctly — week 2 crosses August/September", () => {
    // today = Aug 17, week2 = Aug 24–Aug 30, week3 starts Aug 31
    expect(classifyBucket("2026-08-31", TODAY)).toBe("week3");
    expect(classifyBucket("2026-09-01", TODAY)).toBe("week3");
  });
});

describe("isFundingThroughMonthEnd", () => {
  // Overdue invoices are INCLUDED (they are part of the funding requirement)
  it("includes an overdue invoice (due before today)", () => {
    expect(isFundingThroughMonthEnd("2026-08-10", TODAY)).toBe(true);
  });

  it("includes an invoice due in a prior month (overdue)", () => {
    expect(isFundingThroughMonthEnd("2025-01-01", TODAY)).toBe(true);
  });

  it("includes an invoice due today", () => {
    expect(isFundingThroughMonthEnd("2026-08-17", TODAY)).toBe(true);
  });

  it("includes an invoice due later in the current month", () => {
    expect(isFundingThroughMonthEnd("2026-08-25", TODAY)).toBe(true);
  });

  it("includes an invoice due on the last day of the current month", () => {
    expect(isFundingThroughMonthEnd("2026-08-31", TODAY)).toBe(true);
  });

  // Future-month invoices are EXCLUDED
  it("excludes an invoice due in the next month", () => {
    expect(isFundingThroughMonthEnd("2026-09-01", TODAY)).toBe(false);
  });

  it("excludes an invoice due far in the future", () => {
    expect(isFundingThroughMonthEnd("2027-06-01", TODAY)).toBe(false);
  });

  // Missing due date is EXCLUDED
  it("excludes null due date (missing)", () => {
    expect(isFundingThroughMonthEnd(null, TODAY)).toBe(false);
  });

  it("excludes undefined due date (missing)", () => {
    expect(isFundingThroughMonthEnd(undefined, TODAY)).toBe(false);
  });

  it("excludes empty string due date (missing)", () => {
    expect(isFundingThroughMonthEnd("", TODAY)).toBe(false);
  });

  it("excludes an invalid date string (missing)", () => {
    expect(isFundingThroughMonthEnd("not-a-date", TODAY)).toBe(false);
  });

  // Paid invoice: filtering happens upstream; the helper is payment-status-agnostic
  it("classifies correctly regardless of payment status — caller must pre-filter Paid invoices", () => {
    // A Paid invoice due this month would return true, but callers only pass Unpaid rows.
    expect(isFundingThroughMonthEnd("2026-08-20", TODAY)).toBe(true);
  });

  it("combined: overdue + remaining current month equals total funding requirement", () => {
    // Simulate: EUR 10,000 overdue + EUR 20,000 due later this month = EUR 30,000 total
    const invoices = [
      { dueDate: "2026-08-01", currency: "EUR", grossAmount: "10000.00" }, // overdue — included
      { dueDate: "2026-08-25", currency: "EUR", grossAmount: "20000.00" }, // due this month — included
      { dueDate: "2026-09-05", currency: "EUR", grossAmount: "5000.00" },  // next month — excluded
      { dueDate: null,          currency: "EUR", grossAmount: "1000.00" },  // missing — excluded
    ];
    const fundingRows = invoices.filter((inv) => isFundingThroughMonthEnd(inv.dueDate, TODAY));
    const totals = sumByCurrency(fundingRows);
    expect(totals).toEqual([{ currency: "EUR", total: "30000.00" }]);
  });
});

describe("sumByCurrency", () => {
  it("sums amounts within the same currency", () => {
    const result = sumByCurrency([
      { currency: "EUR", grossAmount: "100.00" },
      { currency: "EUR", grossAmount: "250.50" },
    ]);
    expect(result).toEqual([{ currency: "EUR", total: "350.50" }]);
  });

  it("returns separate totals for different currencies", () => {
    const result = sumByCurrency([
      { currency: "EUR", grossAmount: "100.00" },
      { currency: "USD", grossAmount: "200.00" },
    ]);
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.currency === "EUR")?.total).toBe("100.00");
    expect(result.find((r) => r.currency === "USD")?.total).toBe("200.00");
  });

  it("skips rows with null grossAmount", () => {
    const result = sumByCurrency([
      { currency: "EUR", grossAmount: null },
      { currency: "EUR", grossAmount: "150.00" },
    ]);
    expect(result).toEqual([{ currency: "EUR", total: "150.00" }]);
  });

  it("returns empty array when all amounts are null", () => {
    expect(sumByCurrency([{ currency: "EUR", grossAmount: null }])).toEqual([]);
  });

  it("returns empty array for empty input", () => {
    expect(sumByCurrency([])).toEqual([]);
  });

  it("handles large decimal amounts correctly", () => {
    const result = sumByCurrency([
      { currency: "EUR", grossAmount: "999999999999999.99" },
      { currency: "EUR", grossAmount: "0.01" },
    ]);
    expect(result[0].total).toBe("1000000000000000.00");
  });
});

describe("getWeekDateRange", () => {
  it("week 1 starts today and ends today+6", () => {
    const { start, end } = getWeekDateRange(TODAY, 1);
    expect(start).toBe("2026-08-17");
    expect(end).toBe("2026-08-23");
  });

  it("week 2 starts today+7 and ends today+13", () => {
    const { start, end } = getWeekDateRange(TODAY, 2);
    expect(start).toBe("2026-08-24");
    expect(end).toBe("2026-08-30");
  });

  it("week 3 starts today+14 and ends today+20", () => {
    const { start, end } = getWeekDateRange(TODAY, 3);
    expect(start).toBe("2026-08-31");
    expect(end).toBe("2026-09-06");
  });

  it("week 4 starts today+21 and ends today+27", () => {
    const { start, end } = getWeekDateRange(TODAY, 4);
    expect(start).toBe("2026-09-07");
    expect(end).toBe("2026-09-13");
  });
});
