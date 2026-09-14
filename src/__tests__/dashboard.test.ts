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

const account = (
  id: number,
  name: string,
  clientFundsEligible: boolean,
  overrides: Partial<Parameters<typeof buildDashboardData>[0]["accounts"][number]> = {},
) => ({ id, name, providerName: null, clientFundsEligible, isActive: true, ...overrides });

function input(overrides: Partial<Parameters<typeof buildDashboardData>[0]> = {}): Parameters<typeof buildDashboardData>[0] {
  return {
    today: "2026-09-09",
    baseCurrency: "EUR",
    accounts: [],
    balances: [],
    invoices: [],
    forecastItems: [],
    snapshots: [],
    receivables: null,
    clientLiability: null,
    ...overrides,
  };
}

describe("buildDashboardData", () => {
  it("separates company cash from client money without double counting", () => {
    const result = buildDashboardData(input({
      accounts: [
        account(1, "Operating bank", false),
        account(2, "Client wallet", true, { providerName: "PSP One" }),
        account(3, "Closed company account", false, { isActive: false }),
      ],
      balances: [
        { paymentAccountId: 1, assetCode: "EUR", available: "1000.1000" },
        { paymentAccountId: 1, assetCode: "USD", available: "9999" },
        { paymentAccountId: 2, assetCode: "EUR", available: "600.2500" },
        { paymentAccountId: 3, assetCode: "EUR", available: "9999" },
      ],
      invoices: [invoice(), invoice({ id: 2, baseGrossAmount: null }), invoice({ id: 3, paymentStatus: "Paid" })],
      receivables: "100",
      clientLiability: { value: "550.25", currency: "EUR" },
    }));

    expect(result.companyCash).toBe("1000.1");
    expect(result.clientMoneyHeld).toBe("600.25");
    expect(result.payables).toBe("250.125");
    expect(result.netPosition).toBe("849.975");
    expect(result.clientSurplusDeficit).toBe("50");
    expect(result.clientAccountBalances).toEqual([
      { accountId: 2, name: "PSP One · Client wallet", value: "600.25" },
    ]);
    expect(new Set([result.companyCash, result.clientMoneyHeld])).toEqual(new Set(["1000.1", "600.25"]));
  });

  it("excludes client-funds accounts from the carried-forward company cash series", () => {
    const result = buildDashboardData(input({
      accounts: [account(1, "Operating", false), account(2, "Safeguarding", true)],
      snapshots: [
        { paymentAccountId: 1, assetCode: "EUR", reportedAvailableBalance: "100", asOf: new Date("2026-09-01T10:00:00Z") },
        { paymentAccountId: 2, assetCode: "EUR", reportedAvailableBalance: "900", asOf: new Date("2026-09-01T12:00:00Z") },
        { paymentAccountId: 1, assetCode: "EUR", reportedAvailableBalance: "125", asOf: new Date("2026-09-02T18:00:00Z") },
      ],
      invoices: [invoice(), invoice({ id: 2, dueDate: "2026-09-01" })],
      forecastItems: [{ id: 7, date: "2026-09-12", description: "Customer receipt", direction: "inflow", amount: "90" }],
    }));

    expect(result.cashSeries).toEqual([
      { date: "2026-09-01", value: "100" },
      { date: "2026-09-02", value: "125" },
    ]);
    expect(result.overdueInvoiceCount).toBe(1);
    expect(result.upcoming.map((item) => item.key)).toEqual(["forecast-7", "invoice-1"]);
  });

  it("reports unavailable values instead of silently substituting zero", () => {
    const result = buildDashboardData(input({
      accounts: [account(1, "Operating", false)],
      balances: [{ paymentAccountId: 1, assetCode: "USD", available: "10" }],
    }));

    expect(result.companyCash).toBeNull();
    expect(result.receivables).toBeNull();
    expect(result.netPosition).toBeNull();
    expect(result.clientMoneyHeld).toBeNull();
    expect(result.clientLiability).toBeNull();
    expect(result.clientSurplusDeficit).toBeNull();
    expect(result.payables).toBe("0");
  });

  it("does not compare client funds and liability across currencies", () => {
    const result = buildDashboardData(input({
      accounts: [account(1, "Client wallet", true)],
      balances: [{ paymentAccountId: 1, assetCode: "EUR", available: "100" }],
      clientLiability: { value: "80", currency: "USD" },
    }));

    expect(result.clientMoneyHeld).toBe("100");
    expect(result.clientLiability).toBe("80");
    expect(result.clientLiabilityCurrency).toBe("USD");
    expect(result.clientSurplusDeficit).toBeNull();
  });

  it("treats an existing zero balance as known zero rather than unavailable", () => {
    const result = buildDashboardData(input({
      accounts: [account(1, "Operating", false), account(2, "Client wallet", true)],
      balances: [
        { paymentAccountId: 1, assetCode: "EUR", available: "0" },
        { paymentAccountId: 2, assetCode: "EUR", available: "0" },
      ],
      receivables: "0",
      clientLiability: { value: "0", currency: "EUR" },
    }));

    expect(result.companyCash).toBe("0");
    expect(result.netPosition).toBe("0");
    expect(result.clientMoneyHeld).toBe("0");
    expect(result.clientLiability).toBe("0");
    expect(result.clientSurplusDeficit).toBe("0");
  });
});
