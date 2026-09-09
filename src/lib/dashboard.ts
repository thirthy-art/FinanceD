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
}

export interface DashboardAccountInput {
  id: number;
  name: string;
  isActive: boolean;
}

export interface DashboardSnapshotInput {
  paymentAccountId: number;
  assetCode: string;
  reportedAvailableBalance: string;
  asOf: Date;
}

export interface DashboardData {
  cash: string | null;
  payables: string;
  receivables: null;
  netPosition: string | null;
  unpaidInvoiceCount: number;
  payablesMissingAmountCount: number;
  overdueInvoiceCount: number;
  draftInvoiceCount: number;
  cashSeries: { date: string; value: string }[];
  accountBalances: { accountId: number; name: string; value: string }[];
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

export function buildDashboardData(input: {
  today: string;
  baseCurrency: string;
  invoices: DashboardInvoiceInput[];
  forecastItems: DashboardForecastItemInput[];
  balances: DashboardBalanceInput[];
  accounts: DashboardAccountInput[];
  snapshots: DashboardSnapshotInput[];
}): DashboardData {
  const baseCurrency = input.baseCurrency.toUpperCase();
  const activeAccounts = new Map(
    input.accounts.filter((account) => account.isActive).map((account) => [account.id, account.name]),
  );
  const baseBalances = input.balances.filter(
    (balance) => balance.assetCode.toUpperCase() === baseCurrency && activeAccounts.has(balance.paymentAccountId),
  );
  const accountBalances = baseBalances
    .map((balance) => ({
      accountId: balance.paymentAccountId,
      name: activeAccounts.get(balance.paymentAccountId) ?? "Account",
      value: new Decimal(balance.available).toFixed(),
    }))
    .filter((balance) => !new Decimal(balance.value).isZero())
    .sort((left, right) => new Decimal(right.value).comparedTo(left.value));
  const cash = baseBalances.length > 0 ? sum(baseBalances.map((balance) => balance.available)).toFixed() : null;

  const unpaid = input.invoices.filter((invoice) => invoice.paymentStatus === "Unpaid");
  const payables = sum(unpaid.flatMap((invoice) => invoice.baseGrossAmount === null ? [] : [invoice.baseGrossAmount])).toFixed();
  const netPosition = cash === null ? null : new Decimal(cash).minus(payables).toFixed();

  const latestByAccount = new Map<number, string>();
  const cashSeries: { date: string; value: string }[] = [];
  const baseSnapshots = input.snapshots
    .filter((snapshot) => snapshot.assetCode.toUpperCase() === baseCurrency && activeAccounts.has(snapshot.paymentAccountId))
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
    cash,
    payables,
    receivables: null,
    netPosition,
    unpaidInvoiceCount: unpaid.length,
    payablesMissingAmountCount: unpaid.filter((invoice) => invoice.baseGrossAmount === null).length,
    overdueInvoiceCount: unpaid.filter((invoice) => invoice.dueDate !== null && invoice.dueDate < input.today).length,
    draftInvoiceCount: input.invoices.filter((invoice) => invoice.status === "draft").length,
    cashSeries,
    accountBalances,
    recentInvoices: [...input.invoices]
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(0, 4),
    upcoming: [...invoiceUpcoming, ...manualUpcoming]
      .sort((left, right) => left.date.localeCompare(right.date) || left.key.localeCompare(right.key))
      .slice(0, 4),
  };
}
