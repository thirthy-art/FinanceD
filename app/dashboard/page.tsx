import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowDownRight, ArrowUpRight, CalendarDays, ChevronRight, CircleDollarSign, Clock3, FileText, Landmark, WalletCards } from "lucide-react";
import CompanySelectionRequired from "@/src/components/CompanySelectionRequired";
import { getActiveCompanyForPage } from "@/src/lib/active-company-page";
import { buildDashboardData, clientFundsVisualizationMode, type DashboardData } from "@/src/lib/dashboard";
import { loadDashboardSourceRows } from "@/src/lib/dashboard-source";
import { Decimal } from "@/src/lib/decimal";
import { calculateBalances, type PaymentEvent } from "@/src/lib/payment-ledger";
import { resolveLocale } from "@/src/i18n";
import { LOCALE_COOKIE } from "@/src/i18n/types";
import styles from "./dashboard.module.css";

export const dynamic = "force-dynamic";

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function formatMoney(value: string | null, currency: string) {
  if (value === null) return "—";
  const decimal = new Decimal(value).toDecimalPlaces(2);
  const sign = decimal.isNegative() ? "−" : "";
  const [whole, fraction] = decimal.abs().toFixed(2).split(".");
  const symbols: Record<string, string> = { EUR: "€", USD: "$", GBP: "£", ILS: "₪" };
  const unit = symbols[currency.toUpperCase()] ?? `${currency.toUpperCase()} `;
  return `${sign}${unit}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
}

function formatDate(date: string, locale: string, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(locale, options ?? { month: "short", day: "numeric" })
    .format(new Date(`${date}T00:00:00.000Z`));
}

function KpiCard({ label, value, note, tone, icon: Icon }: {
  label: string;
  value: string;
  note: string;
  tone: "positive" | "negative" | "neutral" | "muted";
  icon: typeof Landmark;
}) {
  return <article className={styles.kpiCard}>
    <div className={styles.kpiTop}><span>{label}</span><span className={styles.kpiIcon}><Icon size={16} aria-hidden="true" /></span></div>
    <strong className={styles.kpiValue} dir="ltr">{value}</strong>
    <span className={`${styles.kpiNote} ${styles[tone]}`}>
      {tone === "positive" && <ArrowUpRight size={13} aria-hidden="true" />}
      {tone === "negative" && <ArrowDownRight size={13} aria-hidden="true" />}
      {note}
    </span>
  </article>;
}

function CashPositionChart({ series, currency, locale }: {
  series: { date: string; value: string }[];
  currency: string;
  locale: string;
}) {
  if (series.length < 2) return <ChartEmpty title="Cash history will appear here" copy="Add at least two reported balance snapshots to see the position over time." />;
  const values = series.map((point) => new Decimal(point.value));
  const min = Decimal.min(...values);
  const max = Decimal.max(...values);
  const range = max.minus(min).isZero() ? new Decimal(1) : max.minus(min);
  const points = series.map((point, index) => {
    const x = new Decimal(index).div(series.length - 1).times(100).toDecimalPlaces(3).toString();
    const y = new Decimal(86).minus(new Decimal(point.value).minus(min).div(range).times(68)).toDecimalPlaces(3).toString();
    return { x, y };
  });
  const line = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const area = `${line} L 100 94 L 0 94 Z`;
  const middle = series[Math.floor(series.length / 2)];
  return <div className={styles.chartWrap}>
    <div className={styles.axisLabels} aria-hidden="true">
      <span>{formatMoney(max.toFixed(), currency)}</span>
      <span>{formatMoney(min.plus(range.div(2)).toFixed(), currency)}</span>
      <span>{formatMoney(min.toFixed(), currency)}</span>
    </div>
    <svg className={styles.areaChart} viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`Available cash position from ${series[0].date} to ${series.at(-1)?.date}`}>
      <defs><linearGradient id="cash-area-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2f6fec" stopOpacity=".24"/><stop offset="1" stopColor="#2f6fec" stopOpacity=".02"/></linearGradient></defs>
      <path className={styles.chartGridLines} d="M 0 18 H 100 M 0 52 H 100 M 0 86 H 100" />
      <path d={area} fill="url(#cash-area-fill)" />
      <path d={line} className={styles.chartLine} />
    </svg>
    <div className={styles.chartDates}>
      <span>{formatDate(series[0].date, locale)}</span><span>{formatDate(middle.date, locale)}</span><span>{formatDate(series.at(-1)!.date, locale)}</span>
    </div>
  </div>;
}

const DONUT_GRADIENTS = [
  { from: "#1855c7", to: "#70a9ff" },
  { from: "#12806d", to: "#72ddc2" },
  { from: "#5d70cb", to: "#adc8ff" },
  { from: "#c9792b", to: "#ffd08a" },
  { from: "#596c87", to: "#b4c3d6" },
];

function ClientFundsDonut({ balances, total, currency }: {
  balances: DashboardData["clientAccountBalances"];
  total: string | null;
  currency: string;
}) {
  const mode = clientFundsVisualizationMode(balances);
  if (mode === "empty") return <ChartEmpty title="No client-funds balances" copy="Base-currency balances will appear here when an eligible client-funds account holds money." compact />;
  if (mode === "breakdown") return <div className={styles.balanceBreakdown}>
    <p>{balances.some((balance) => new Decimal(balance.totalHeld).isNegative())
      ? "A donut is not shown because one or more account balances are negative."
      : "There are no positive balances to chart."}</p>
    {balances.map((balance) => <ClientAccountBalance key={balance.accountId} balance={balance} currency={currency} />)}
  </div>;
  const chartTotal = balances.reduce((sum, balance) => sum.plus(balance.totalHeld), new Decimal(0));
  const segments = balances.reduce<{ cursor: Decimal; items: { length: string; offset: string; gradientIndex: number }[] }>((result, balance, index) => {
    const length = new Decimal(balance.totalHeld).div(chartTotal).times(100);
    return {
      cursor: result.cursor.plus(length),
      items: [...result.items, {
        length: length.toDecimalPlaces(4).toString(),
        offset: result.cursor.negated().toDecimalPlaces(4).toString(),
        gradientIndex: index % DONUT_GRADIENTS.length,
      }],
    };
  }, { cursor: new Decimal(0), items: [] }).items;
  return <div className={styles.donutLayout}>
    <div className={styles.donut}>
      <svg className={styles.donutSvg} viewBox="0 0 120 120" role="img" aria-label="Client funds by payment account and provider">
        <defs>
          {DONUT_GRADIENTS.map((gradient, index) => <linearGradient key={gradient.from} id={`cash-by-psp-gradient-${index}`} gradientUnits="userSpaceOnUse" x1="18" y1="16" x2="104" y2="106">
            <stop offset="0" stopColor={gradient.from} />
            <stop offset="1" stopColor={gradient.to} />
          </linearGradient>)}
        </defs>
        {segments.map((segment, index) => <circle
          key={balances[index].accountId}
          cx="60"
          cy="60"
          r="48"
          fill="none"
          pathLength="100"
          stroke={`url(#cash-by-psp-gradient-${segment.gradientIndex})`}
          strokeWidth="24"
          strokeDasharray={`${segment.length} ${new Decimal(100).minus(segment.length).toString()}`}
          strokeDashoffset={segment.offset}
          transform="rotate(-90 60 60)"
        />)}
      </svg>
      <div className={styles.donutCenter}><strong dir="ltr">{formatMoney(total, currency)}</strong><span>held</span></div>
    </div>
    <div className={styles.legend}>
      {balances.slice(0, 5).map((balance, index) => <div className={styles.legendRow} key={balance.accountId}>
        <span className={styles.legendDot} style={{ background: `linear-gradient(135deg, ${DONUT_GRADIENTS[index % DONUT_GRADIENTS.length].from}, ${DONUT_GRADIENTS[index % DONUT_GRADIENTS.length].to})` }} />
        <span className={styles.legendAccount}><span className={styles.legendName}>{balance.name}</span><span className={styles.balanceDetail}>Available {formatMoney(balance.available, currency)} · Reserve {formatMoney(balance.reserve, currency)} · Total {formatMoney(balance.totalHeld, currency)}</span></span>
        <b>{new Decimal(balance.totalHeld).div(chartTotal).times(100).toDecimalPlaces(0).toString()}%</b>
      </div>)}
    </div>
  </div>;
}

function ClientAccountBalance({ balance, currency }: {
  balance: DashboardData["clientAccountBalances"][number];
  currency: string;
}) {
  return <div className={styles.balanceBreakdownRow}>
    <strong>{balance.name}</strong>
    <span>Available <b dir="ltr">{formatMoney(balance.available, currency)}</b></span>
    <span>Reserve <b dir="ltr">{formatMoney(balance.reserve, currency)}</b></span>
    <span>Total held <b dir="ltr">{formatMoney(balance.totalHeld, currency)}</b></span>
  </div>;
}

function ChartEmpty({ title, copy, compact = false }: { title: string; copy: string; compact?: boolean }) {
  return <div className={`${styles.chartEmpty} ${compact ? styles.chartEmptyCompact : ""}`}>
    <span className={styles.emptyChartIcon}><Clock3 size={20} aria-hidden="true" /></span>
    <strong>{title}</strong><span>{copy}</span>
  </div>;
}

function PanelHeader({ title, href, linkLabel, children }: { title: string; href?: string; linkLabel?: string; children?: React.ReactNode }) {
  return <header className={styles.panelHeader}><h2>{title}</h2><div>{children}{href && <Link href={href} className={styles.panelLink}>{linkLabel ?? "View all"}<ChevronRight size={13} aria-hidden="true" /></Link>}</div></header>;
}

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const locale = resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value);
  const company = await getActiveCompanyForPage();
  if (!company) return <CompanySelectionRequired locale={locale} />;
  const { invoiceRows, forecastRows, accounts, openings, eventRows, snapshotRows } = await loadDashboardSourceRows(company.id);
  const events = eventRows.map((event) => ({
    ...event,
    balanceAmount: String(event.balanceAmount), sourceAmount: event.sourceAmount === null ? null : String(event.sourceAmount),
    actualFeeAmount: event.actualFeeAmount === null ? null : String(event.actualFeeAmount),
    expectedFxRate: event.expectedFxRate === null ? null : String(event.expectedFxRate),
    reportedAvailableBalance: event.reportedAvailableBalance === null ? null : String(event.reportedAvailableBalance),
    reportedReserveBalance: event.reportedReserveBalance === null ? null : String(event.reportedReserveBalance),
    destinationAmount: event.destinationAmount === null ? null : String(event.destinationAmount),
    expectedDestinationAmount: event.expectedDestinationAmount === null ? null : String(event.expectedDestinationAmount),
    expectedDestinationRate: event.expectedDestinationRate === null ? null : String(event.expectedDestinationRate),
  })) as PaymentEvent[];
  const balances = calculateBalances(
    openings.map((row) => ({ ...row, openingAvailableBalance: String(row.openingAvailableBalance), openingReserveBalance: String(row.openingReserveBalance) })),
    events,
    snapshotRows.map((row) => ({ ...row, reportedAvailableBalance: String(row.reportedAvailableBalance), reportedReserveBalance: row.reportedReserveBalance === null ? null : String(row.reportedReserveBalance) })),
  );
  const today = todayString();
  const data = buildDashboardData({
    today,
    baseCurrency: company.baseCurrency,
    invoices: invoiceRows.map((row) => ({ ...row, baseGrossAmount: row.baseGrossAmount === null ? null : String(row.baseGrossAmount) })),
    forecastItems: forecastRows.map((row) => ({ ...row, amount: String(row.amount) })),
    balances,
    accounts,
    snapshots: snapshotRows.map((row) => ({ ...row, reportedAvailableBalance: String(row.reportedAvailableBalance) })),
    receivables: null,
    authoritativeClientLiability: null,
  });
  return <DashboardScreen company={company} locale={locale} today={today} data={data} />;
}

function DashboardScreen({ company, locale, today, data }: {
  company: { name: string; baseCurrency: string };
  locale: string;
  today: string;
  data: DashboardData;
}) {
  const currentDate = new Date(`${today}T00:00:00Z`);
  const monthLabel = new Intl.DateTimeFormat(locale, { month: "short", year: "numeric", timeZone: "UTC" }).format(currentDate);
  const firstOfMonth = new Date(Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth(), 1));
  const lastOfMonth = new Date(Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth() + 1, 0));
  const dateRange = `${new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "UTC" }).format(firstOfMonth)} – ${new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(lastOfMonth)}`;
  return <div className={styles.page}>
    <header className={styles.pageHeader}>
      <div><h1>Dashboard</h1><p>Key financial overview for {company.name}</p></div>
      <div className={styles.period}><CalendarDays size={15} aria-hidden="true" /><span className={styles.desktopPeriod}>{dateRange}</span><span className={styles.mobilePeriod}>{monthLabel}</span></div>
    </header>

    <section className={styles.financialSection} aria-labelledby="company-funds-heading">
      <h2 className={styles.sectionTitle} id="company-funds-heading">Company funds</h2>
      <div className={styles.kpiGrid}>
      <KpiCard label="Total company cash" value={formatMoney(data.companyCash, company.baseCurrency)} note={data.companyCash === null ? "No base-currency company balance data" : "Available + reserve · company accounts only"} tone={data.companyCash === null ? "muted" : "positive"} icon={WalletCards} />
      <KpiCard label="Receivables" value={formatMoney(data.receivables, company.baseCurrency)} note="Unavailable: no customer-invoice source" tone="muted" icon={CircleDollarSign} />
      <KpiCard label="Payables" value={formatMoney(data.payables, company.baseCurrency)} note={`${data.unpaidInvoiceCount} unpaid · ${data.overdueInvoiceCount} overdue${data.payablesMissingAmountCount > 0 ? ` · ${data.payablesMissingAmountCount} without base amount` : ""}`} tone={data.overdueInvoiceCount > 0 || data.payablesMissingAmountCount > 0 ? "negative" : "neutral"} icon={FileText} />
      <KpiCard label="Net position" value={formatMoney(data.netPosition, company.baseCurrency)} note={data.netPosition === null ? "Unavailable while a formula input is unavailable" : "Company cash + receivables − payables"} tone={data.netPosition !== null && new Decimal(data.netPosition).isNegative() ? "negative" : data.netPosition === null ? "muted" : "positive"} icon={Landmark} />
      </div>

      <article className={`${styles.panel} ${styles.cashPanel}`}>
        <PanelHeader title="Available cash position"><span className={styles.panelMeta}>Company accounts · reported available balance history</span></PanelHeader>
        <CashPositionChart series={data.cashSeries} currency={company.baseCurrency} locale={locale} />
      </article>
    </section>

    <section className={styles.financialSection} aria-labelledby="client-funds-heading">
      <h2 className={styles.sectionTitle} id="client-funds-heading">Client funds</h2>
      <div className={styles.clientKpiGrid}>
        <KpiCard label="Client money held" value={formatMoney(data.clientMoneyHeld, company.baseCurrency)} note={data.clientMoneyHeld === null ? "No base-currency client-funds balance data" : `Available ${formatMoney(data.immediatelyAvailableClientFunds, company.baseCurrency)} · reserve ${formatMoney(data.clientReserveHeld, company.baseCurrency)}`} tone={data.clientMoneyHeld === null ? "muted" : "positive"} icon={WalletCards} />
        <KpiCard label="Client liability" value={formatMoney(data.clientLiability, data.clientLiabilityCurrency ?? company.baseCurrency)} note="Unavailable: no authoritative current-liability source" tone="muted" icon={CircleDollarSign} />
        <KpiCard label="Surplus / deficit" value={formatMoney(data.clientSurplusDeficit, company.baseCurrency)} note={data.clientSurplusDeficit === null ? "Unavailable until held funds and liability are comparable" : `Total held coverage · available coverage ${formatMoney(data.clientAvailableSurplusDeficit, company.baseCurrency)}`} tone={data.clientSurplusDeficit === null ? "muted" : new Decimal(data.clientSurplusDeficit).isNegative() ? "negative" : "positive"} icon={Landmark} />
      </div>
      <article className={`${styles.panel} ${styles.pspPanel}`}>
        <PanelHeader title="Cash by PSP / EMI / wallet" href="/reconciliation/payment-accounts"><span className={styles.panelMeta}>Client funds only</span></PanelHeader>
        <ClientFundsDonut balances={data.clientAccountBalances} total={data.clientMoneyHeld} currency={company.baseCurrency} />
      </article>
    </section>

    <section className={styles.lowerGrid}>
      <article className={styles.panel}>
        <PanelHeader title="Recent Invoices" href="/" />
        {data.recentInvoices.length === 0 ? <div className={styles.listEmpty}>No invoices yet. Uploaded supplier invoices will appear here.</div> : <div className={styles.dataList}>
          <div className={styles.listHead}><span>Date</span><span>Vendor</span><span>Amount</span><span>Status</span></div>
          {data.recentInvoices.map((invoice) => <Link href={`/invoices/${invoice.id}`} className={styles.listRow} key={invoice.id}>
            <span>{invoice.invoiceDate ? formatDate(invoice.invoiceDate, locale) : "—"}</span>
            <span className={styles.primaryCell}>{invoice.vendorName ?? invoice.invoiceNumber ?? `Invoice #${invoice.id}`}</span>
            <span dir="ltr">{formatMoney(invoice.baseGrossAmount, company.baseCurrency)}</span>
            <span className={`${styles.status} ${invoice.paymentStatus === "Paid" ? styles.statusPaid : invoice.status === "draft" ? styles.statusDraft : styles.statusOpen}`}>{invoice.paymentStatus === "Paid" ? "Paid" : invoice.status === "draft" ? "Draft" : "Open"}</span>
          </Link>)}
        </div>}
      </article>
      <article className={styles.panel}>
        <PanelHeader title="Upcoming Cash Flow" href="/cash-flow" />
        {data.upcoming.length === 0 ? <div className={styles.listEmpty}>No dated payables or forecast entries are coming up.</div> : <div className={styles.dataList}>
          <div className={`${styles.listHead} ${styles.cashList}`}><span>Date</span><span>Description</span><span>Amount</span></div>
          {data.upcoming.map((item) => <Link href={item.href} className={`${styles.listRow} ${styles.cashList}`} key={item.key}>
            <span>{formatDate(item.date, locale)}</span><span className={styles.primaryCell}>{item.description}</span>
            <span className={item.direction === "inflow" ? styles.inflow : styles.outflow} dir="ltr">{item.direction === "inflow" ? "+" : "−"}{formatMoney(item.amount, company.baseCurrency)}</span>
          </Link>)}
        </div>}
      </article>
    </section>
  </div>;
}
