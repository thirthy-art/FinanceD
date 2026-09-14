import { describe, expect, it } from "vitest";
import { buildDashboardData, clientFundsVisualizationMode } from "@/src/lib/dashboard";
import { Decimal } from "@/src/lib/decimal";

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

const balance = (paymentAccountId: number, available: string, reserve = "0", assetCode = "EUR") => ({
  paymentAccountId,
  assetCode,
  available,
  reserve,
  totalOwned: new Decimal(available).plus(reserve).toFixed(),
});

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
    authoritativeClientLiability: null,
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
        balance(1, "1000.1000"),
        balance(1, "9999", "0", "USD"),
        balance(2, "600.2500"),
        balance(3, "9999"),
      ],
      invoices: [invoice(), invoice({ id: 2, baseGrossAmount: null }), invoice({ id: 3, paymentStatus: "Paid" })],
      receivables: "100",
      authoritativeClientLiability: { value: "550.25", currency: "EUR" },
    }));

    expect(result.companyCash).toBe("1000.1");
    expect(result.clientMoneyHeld).toBe("600.25");
    expect(result.payables).toBe("250.125");
    expect(result.netPosition).toBe("849.975");
    expect(result.clientSurplusDeficit).toBe("50");
    expect(result.clientAccountBalances).toEqual([
      { accountId: 2, name: "PSP One · Client wallet", available: "600.25", reserve: "0", totalHeld: "600.25" },
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
      balances: [balance(1, "10", "0", "USD")],
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
      balances: [balance(1, "100")],
      authoritativeClientLiability: { value: "80", currency: "USD" },
    }));

    expect(result.clientMoneyHeld).toBe("100");
    expect(result.clientLiability).toBe("80");
    expect(result.clientLiabilityCurrency).toBe("USD");
    expect(result.clientSurplusDeficit).toBeNull();
    expect(result.clientAvailableSurplusDeficit).toBeNull();
  });

  it("treats an existing zero balance as known zero rather than unavailable", () => {
    const result = buildDashboardData(input({
      accounts: [account(1, "Operating", false), account(2, "Client wallet", true)],
      balances: [
        balance(1, "0"),
        balance(2, "0"),
      ],
      receivables: "0",
      authoritativeClientLiability: { value: "0", currency: "EUR" },
    }));

    expect(result.companyCash).toBe("0");
    expect(result.netPosition).toBe("0");
    expect(result.clientMoneyHeld).toBe("0");
    expect(result.clientLiability).toBe("0");
    expect(result.clientSurplusDeficit).toBe("0");
    expect(result.clientAvailableSurplusDeficit).toBe("0");
  });

  it("uses total owned for client funds while preserving available and reserve", () => {
    const result = buildDashboardData(input({
      accounts: [account(1, "Client wallet", true)],
      balances: [balance(1, "100", "20")],
      authoritativeClientLiability: { value: "110", currency: "EUR" },
    }));

    expect(result.clientMoneyHeld).toBe("120");
    expect(result.immediatelyAvailableClientFunds).toBe("100");
    expect(result.clientReserveHeld).toBe("20");
    expect(result.clientSurplusDeficit).toBe("10");
    expect(result.clientAvailableSurplusDeficit).toBe("-10");
    expect(result.clientAccountBalances[0]).toMatchObject({ available: "100", reserve: "20", totalHeld: "120" });
  });

  it("a reserve hold shifts liquidity without reducing either company or client ownership", () => {
    const before = buildDashboardData(input({
      accounts: [account(1, "Operating", false), account(2, "Client", true)],
      balances: [balance(1, "100", "20"), balance(2, "100", "20")],
    }));
    const after = buildDashboardData(input({
      accounts: [account(1, "Operating", false), account(2, "Client", true)],
      balances: [balance(1, "80", "40"), balance(2, "80", "40")],
    }));

    expect(after.companyCash).toBe(before.companyCash);
    expect(after.clientMoneyHeld).toBe(before.clientMoneyHeld);
    expect(after.immediatelyAvailableClientFunds).toBe("80");
    expect(after.clientReserveHeld).toBe("40");
  });

  it("keeps client accounts out of company totals and company accounts out of client totals", () => {
    const result = buildDashboardData(input({
      accounts: [account(1, "Operating", false), account(2, "Client", true)],
      balances: [balance(1, "100", "10"), balance(2, "900", "90")],
      invoices: [invoice({ baseGrossAmount: "25" })],
      receivables: "15",
    }));

    expect(result.companyCash).toBe("110");
    expect(result.clientMoneyHeld).toBe("990");
    expect(result.netPosition).toBe("100");
    expect(result.clientAccountBalances.map((row) => row.accountId)).toEqual([2]);
  });

  it("uses a non-donut breakdown whenever a client total-held balance is negative", () => {
    const result = buildDashboardData(input({
      accounts: [account(1, "Positive", true), account(2, "Negative", true)],
      balances: [balance(1, "100"), balance(2, "-20")],
    }));

    expect(result.clientMoneyHeld).toBe("80");
    expect(clientFundsVisualizationMode(result.clientAccountBalances)).toBe("breakdown");
  });

  it("leaves both comparisons unavailable without authoritative liability", () => {
    const result = buildDashboardData(input({
      accounts: [account(1, "Client", true)],
      balances: [balance(1, "100", "20")],
      authoritativeClientLiability: null,
    }));

    expect(result.clientLiability).toBeNull();
    expect(result.clientSurplusDeficit).toBeNull();
    expect(result.clientAvailableSurplusDeficit).toBeNull();
  });

  it("does not compare either total or available client funds across currencies", () => {
    const result = buildDashboardData(input({
      accounts: [account(1, "Client", true)],
      balances: [balance(1, "100", "20")],
      authoritativeClientLiability: { value: "90", currency: "USD" },
    }));

    expect(result.clientSurplusDeficit).toBeNull();
    expect(result.clientAvailableSurplusDeficit).toBeNull();
  });
});
