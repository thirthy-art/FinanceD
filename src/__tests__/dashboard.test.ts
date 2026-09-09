import { describe, expect, it } from "vitest";
import { buildDashboardData } from "@/src/lib/dashboard";

const invoice = (overrides: Partial<Parameters<typeof buildDashboardData>[0]["invoices"][number]> = {}) => ({
  id: 1,
  vendorName: "Northwind",
  invoiceNumber: "INV-1",
  invoiceDate: "2026-09-01",
  dueDate: "2026-09-20",
  baseGrossAmount: "250.1250",
  status: "approved" as const,
  paymentStatus: "Unpaid" as const,
  createdAt: new Date("2026-09-01T12:00:00Z"),
  ...overrides,
});

describe("buildDashboardData", () => {
  it("aggregates only active-company base-currency positions with Decimal arithmetic", () => {
    const result = buildDashboardData({
      today: "2026-09-09",
      baseCurrency: "EUR",
      accounts: [{ id: 1, name: "Revolut", isActive: true }, { id: 2, name: "Old", isActive: false }],
      balances: [
        { paymentAccountId: 1, assetCode: "EUR", available: "1000.1000" },
        { paymentAccountId: 1, assetCode: "USD", available: "9999" },
        { paymentAccountId: 2, assetCode: "EUR", available: "9999" },
      ],
      invoices: [invoice(), invoice({ id: 2, baseGrossAmount: null }), invoice({ id: 3, paymentStatus: "Paid" })],
      forecastItems: [],
      snapshots: [],
    });
    expect(result.cash).toBe("1000.1");
    expect(result.payables).toBe("250.125");
    expect(result.netPosition).toBe("749.975");
    expect(result.unpaidInvoiceCount).toBe(2);
    expect(result.payablesMissingAmountCount).toBe(1);
    expect(result.accountBalances).toEqual([{ accountId: 1, name: "Revolut", value: "1000.1" }]);
  });

  it("builds a carried-forward cash series and truthful upcoming feed", () => {
    const result = buildDashboardData({
      today: "2026-09-09",
      baseCurrency: "EUR",
      accounts: [{ id: 1, name: "One", isActive: true }, { id: 2, name: "Two", isActive: true }],
      balances: [],
      invoices: [invoice(), invoice({ id: 2, dueDate: "2026-09-01" })],
      forecastItems: [{ id: 7, date: "2026-09-12", description: "Customer receipt", direction: "inflow", amount: "90" }],
      snapshots: [
        { paymentAccountId: 1, assetCode: "EUR", reportedAvailableBalance: "100", asOf: new Date("2026-09-01T10:00:00Z") },
        { paymentAccountId: 2, assetCode: "EUR", reportedAvailableBalance: "50", asOf: new Date("2026-09-02T10:00:00Z") },
        { paymentAccountId: 1, assetCode: "EUR", reportedAvailableBalance: "125", asOf: new Date("2026-09-02T18:00:00Z") },
      ],
    });
    expect(result.cashSeries).toEqual([
      { date: "2026-09-01", value: "100" },
      { date: "2026-09-02", value: "175" },
    ]);
    expect(result.overdueInvoiceCount).toBe(1);
    expect(result.upcoming.map((item) => item.key)).toEqual(["forecast-7", "invoice-1"]);
  });
});
