import { Decimal } from "@/src/lib/decimal";

export interface DashboardInvoiceInput {
  id: number;
  vendorName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  baseGrossAmount: string | null;
  status: "draft" | "approved";
  paymentStatus: "Paid" | "Unpaid";
  createdAt: Date;
}

export interface DashboardForecastItemInput {
  id: number;
  date: string;
  description: string;
  direction: "inflow" | "outflow";
  amount: string;
}

export interface DashboardBalanceInput {
  paymentAccountId: number;
  assetCode: string;
  available: string;
  reserve: string;
  totalOwned: string;
}

export interface DashboardAccountInput {
  id: number;
  name: string;
  providerName: string | null;
  clientFundsEligible: boolean;
  isActive: boolean;
}

export interface DashboardSnapshotInput {
  paymentAccountId: number;
  assetCode: string;
  reportedAvailableBalance: string;
  asOf: Date;
}

export interface DashboardData {
  companyCash: string | null;
  payables: string;
  receivables: string | null;
  netPosition: string | null;
  clientMoneyHeld: string | null;
  immediatelyAvailableClientFunds: string | null;
  clientReserveHeld: string | null;
  clientLiability: string | null;
  clientLiabilityCurrency: string | null;
  clientSurplusDeficit: string | null;
  clientAvailableSurplusDeficit: string | null;
  unpaidInvoiceCount: number;
  payablesMissingAmountCount: number;
  overdueInvoiceCount: number;
  draftInvoiceCount: number;
  cashSeries: { date: string; value: string }[];
  clientAccountBalances: {
    accountId: number;
    name: string;
    available: string;
    reserve: string;
    totalHeld: string;
  }[];
  recentInvoices: DashboardInvoiceInput[];
  upcoming: {
    key: string;
    date: string;
    description: string;
    amount: string;
    direction: "inflow" | "outflow";
    href: string;
  }[];
}

function sum(values: string[]): Decimal {
  return values.reduce((total, value) => total.plus(value), new Decimal(0));
}

export function clientFundsVisualizationMode(
  balances: DashboardData["clientAccountBalances"],
): "donut" | "breakdown" | "empty" {
  if (balances.length === 0) return "empty";
  if (balances.some((balance) => new Decimal(balance.totalHeld).isNegative())) return "breakdown";
  return balances.some((balance) => new Decimal(balance.totalHeld).isPositive()) ? "donut" : "breakdown";
}

export function buildDashboardData(input: {
  today: string;
  baseCurrency: string;
  invoices: DashboardInvoiceInput[];
  forecastItems: DashboardForecastItemInput[];
  balances: DashboardBalanceInput[];
  accounts: DashboardAccountInput[];
  snapshots: DashboardSnapshotInput[];
  receivables: string | null;
  authoritativeClientLiability: { value: string; currency: string } | null;
}): DashboardData {
  const baseCurrency = input.baseCurrency.toUpperCase();
  const activeAccounts = new Map(
    input.accounts.filter((account) => account.isActive).map((account) => [account.id, account]),
  );
  const baseBalances = input.balances.filter(
    (balance) => balance.assetCode.toUpperCase() === baseCurrency && activeAccounts.has(balance.paymentAccountId),
  );
  const companyBalances = baseBalances.filter(
    (balance) => activeAccounts.get(balance.paymentAccountId)?.clientFundsEligible === false,
  );
  const clientBalances = baseBalances.filter(
    (balance) => activeAccounts.get(balance.paymentAccountId)?.clientFundsEligible === true,
  );
  const clientAccountBalances = clientBalances
    .map((balance) => ({
      accountId: balance.paymentAccountId,
      name: (() => {
        const account = activeAccounts.get(balance.paymentAccountId);
        if (!account) return "Account";
        return account.providerName && account.providerName !== account.name
          ? `${account.providerName} · ${account.name}`
          : account.name;
      })(),
      available: new Decimal(balance.available).toFixed(),
      reserve: new Decimal(balance.reserve).toFixed(),
      totalHeld: new Decimal(balance.totalOwned).toFixed(),
    }))
    .sort((left, right) => new Decimal(right.totalHeld).comparedTo(left.totalHeld));
  // A reserve hold changes liquidity, not ownership. Dashboard cash therefore uses
  // the ledger's canonical totalOwned (available + reserve), excluding transit.
  const companyCash = companyBalances.length > 0 ? sum(companyBalances.map((balance) => balance.totalOwned)).toFixed() : null;
  const clientMoneyHeld = clientBalances.length > 0 ? sum(clientBalances.map((balance) => balance.totalOwned)).toFixed() : null;
  const immediatelyAvailableClientFunds = clientBalances.length > 0 ? sum(clientBalances.map((balance) => balance.available)).toFixed() : null;
  const clientReserveHeld = clientBalances.length > 0 ? sum(clientBalances.map((balance) => balance.reserve)).toFixed() : null;

  const unpaid = input.invoices.filter((invoice) => invoice.paymentStatus === "Unpaid");
  const payables = sum(unpaid.flatMap((invoice) => invoice.baseGrossAmount === null ? [] : [invoice.baseGrossAmount])).toFixed();
  const netPosition = companyCash === null || input.receivables === null
    ? null
    : new Decimal(companyCash).plus(input.receivables).minus(payables).toFixed();
  const clientLiabilityCurrency = input.authoritativeClientLiability?.currency.toUpperCase() ?? null;
  const clientSurplusDeficit = clientMoneyHeld !== null
    && input.authoritativeClientLiability !== null
    && clientLiabilityCurrency === baseCurrency
    ? new Decimal(clientMoneyHeld).minus(input.authoritativeClientLiability.value).toFixed()
    : null;
  const clientAvailableSurplusDeficit = immediatelyAvailableClientFunds !== null
    && input.authoritativeClientLiability !== null
    && clientLiabilityCurrency === baseCurrency
    ? new Decimal(immediatelyAvailableClientFunds).minus(input.authoritativeClientLiability.value).toFixed()
    : null;

  const latestByAccount = new Map<number, string>();
  const cashSeries: { date: string; value: string }[] = [];
  const baseSnapshots = input.snapshots
    .filter((snapshot) => snapshot.assetCode.toUpperCase() === baseCurrency
      && activeAccounts.get(snapshot.paymentAccountId)?.clientFundsEligible === false)
    .sort((left, right) => left.asOf.getTime() - right.asOf.getTime());
  for (const snapshot of baseSnapshots) {
    latestByAccount.set(snapshot.paymentAccountId, snapshot.reportedAvailableBalance);
    const date = snapshot.asOf.toISOString().slice(0, 10);
    const value = sum([...latestByAccount.values()]).toFixed();
    const previous = cashSeries.at(-1);
    if (previous?.date === date) previous.value = value;
    else cashSeries.push({ date, value });
  }

  const invoiceUpcoming = unpaid.flatMap((invoice) => {
    if (!invoice.dueDate || invoice.dueDate < input.today || invoice.baseGrossAmount === null) return [];
    return [{
      key: `invoice-${invoice.id}`,
      date: invoice.dueDate,
      description: invoice.vendorName ?? invoice.invoiceNumber ?? `Invoice #${invoice.id}`,
      amount: invoice.baseGrossAmount,
      direction: "outflow" as const,
      href: `/invoices/${invoice.id}`,
    }];
  });
  const manualUpcoming = input.forecastItems.flatMap((item) => item.date < input.today ? [] : [{
    key: `forecast-${item.id}`,
    date: item.date,
    description: item.description,
    amount: item.amount,
    direction: item.direction,
    href: "/cash-flow?view=forecast",
  }]);

  return {
    companyCash,
    payables,
    receivables: input.receivables,
    netPosition,
    clientMoneyHeld,
    immediatelyAvailableClientFunds,
    clientReserveHeld,
    clientLiability: input.authoritativeClientLiability?.value ?? null,
    clientLiabilityCurrency,
    clientSurplusDeficit,
    clientAvailableSurplusDeficit,
    unpaidInvoiceCount: unpaid.length,
    payablesMissingAmountCount: unpaid.filter((invoice) => invoice.baseGrossAmount === null).length,
    overdueInvoiceCount: unpaid.filter((invoice) => invoice.dueDate !== null && invoice.dueDate < input.today).length,
    draftInvoiceCount: input.invoices.filter((invoice) => invoice.status === "draft").length,
    cashSeries,
    clientAccountBalances,
    recentInvoices: [...input.invoices]
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(0, 4),
    upcoming: [...invoiceUpcoming, ...manualUpcoming]
      .sort((left, right) => left.date.localeCompare(right.date) || left.key.localeCompare(right.key))
      .slice(0, 4),
  };
}
