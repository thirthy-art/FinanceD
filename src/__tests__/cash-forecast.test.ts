import { describe, expect, it } from "vitest";
import { calculateCashForecast, currentWeekStart } from "@/src/lib/cash-forecast";

const base = {
  today: "2026-09-04", // Friday; current week is Mon Aug 31–Sun Sep 6
  openingCash: "1000.0000",
  minimumBuffer: "0.0000",
  manualItems: [],
  apItems: [],
};

describe("13-week cash forecast", () => {
  it("creates exactly 13 deterministic Monday-Sunday buckets", () => {
    const result = calculateCashForecast(base);
    expect(currentWeekStart(base.today)).toBe("2026-08-31");
    expect(result.weeks).toHaveLength(13);
    expect(result.weeks[0]).toMatchObject({ start: "2026-08-31", end: "2026-09-06" });
    expect(result.weeks[12]).toMatchObject({ start: "2026-11-23", end: "2026-11-29" });
  });

  it("rolls each closing balance into the next opening balance", () => {
    const result = calculateCashForecast({ ...base, manualItems: [
      { id: 1, date: "2026-09-01", description: "Receipt", direction: "inflow", category: "customer_receipts", amount: "25.1000" },
    ] });
    expect(result.weeks[0].closingCash).toBe("1025.1000");
    expect(result.weeks[1].openingCash).toBe("1025.1000");
  });

  it("adds manual inflows and subtracts manual outflows exactly", () => {
    const result = calculateCashForecast({ ...base, manualItems: [
      { id: 1, date: "2026-09-01", description: "Receipt", direction: "inflow", category: "customer_receipts", amount: "0.1000" },
      { id: 2, date: "2026-09-02", description: "Payroll", direction: "outflow", category: "payroll", amount: "0.2000" },
    ] });
    expect(result.weeks[0]).toMatchObject({ manualInflows: "0.1000", manualOutflows: "0.2000", netMovement: "-0.1000", closingCash: "999.9000" });
  });

  it("places AP in its due week and overdue AP in Week 1", () => {
    const result = calculateCashForecast({ ...base, apItems: [
      { id: 1, dueDate: "2026-09-09", baseGrossAmount: "10.0000" },
      { id: 2, dueDate: "2026-08-01", baseGrossAmount: "20.0000" },
    ] });
    expect(result.weeks[0].apOutflows).toBe("20.0000");
    expect(result.weeks[1].apOutflows).toBe("10.0000");
  });

  it("excludes AP after Week 13", () => {
    const result = calculateCashForecast({ ...base, apItems: [
      { id: 1, dueDate: "2026-11-30", baseGrossAmount: "500.0000" },
    ] });
    expect(result.projectedClosingCash).toBe("1000.0000");
  });

  it("counts and excludes missing due dates and unsafe base amounts", () => {
    const result = calculateCashForecast({ ...base, apItems: [
      { id: 1, dueDate: null, baseGrossAmount: "10.0000" },
      { id: 2, dueDate: "2026-09-01", baseGrossAmount: null },
      { id: 3, dueDate: "2026-09-01", baseGrossAmount: "not-money" },
    ] });
    expect(result.missingDueDateCount).toBe(1);
    expect(result.missingBaseAmountCount).toBe(2);
    expect(result.projectedClosingCash).toBe("1000.0000");
  });

  it("identifies the first minimum-buffer breach", () => {
    const result = calculateCashForecast({ ...base, minimumBuffer: "900.0000", manualItems: [
      { id: 1, date: "2026-09-08", description: "Payroll", direction: "outflow", category: "payroll", amount: "150.0000" },
      { id: 2, date: "2026-09-15", description: "Rent", direction: "outflow", category: "rent", amount: "100.0000" },
    ] });
    expect(result.firstBufferBreachWeekIndex).toBe(1);
    expect(result.lowestWeekIndex).toBe(2);
    expect(result.lowestProjectedCash).toBe("750.0000");
  });

  it("reports no warning when no week breaches the buffer", () => {
    expect(calculateCashForecast({ ...base, minimumBuffer: "999.0000" }).firstBufferBreachWeekIndex).toBeNull();
  });
});
