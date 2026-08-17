import { getDb } from "@/src/db";
import { supplierInvoices, vendors, companies } from "@/src/db/schema";
import { eq, desc } from "drizzle-orm";
import {
  classifyBucket,
  isDueThisMonth,
  sumByCurrency,
  getWeekDateRange,
  formatShortDate,
  BUCKET_LABELS,
  type Bucket,
} from "@/src/lib/cash-flow-buckets";
import { formatDisplayAmount } from "@/src/lib/invoice-validation";
import Link from "next/link";
import CashFlowView, {
  type WeekData,
  type WeeklyInvoice,
  type OverdueData,
} from "@/src/components/CashFlowView";

export const dynamic = "force-dynamic";

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

function paymentStatusBadge(status: string, dueDate: string | null, today: string) {
  const isOverdue = dueDate && dueDate < today;
  if (isOverdue) {
    return (
      <span style={{ background: "#fee2e2", color: "#dc2626", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600 }}>
        Overdue
      </span>
    );
  }
  if (!dueDate) {
    return (
      <span style={{ background: "#fef9c3", color: "#713f12", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600 }}>
        No due date
      </span>
    );
  }
  return (
    <span style={{ background: "#dbeafe", color: "#1e40af", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600 }}>
      {status === "approved" ? "Approved" : "Draft"}
    </span>
  );
}

function approvalBadge(status: "draft" | "approved") {
  return status === "approved"
    ? <span style={{ background: "#dcfce7", color: "#166534", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600 }}>Approved</span>
    : <span style={{ background: "#fef9c3", color: "#713f12", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600 }}>Draft</span>;
}

function SummaryCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  accent?: string;
}) {
  return (
    <div style={{
      flex: "1 1 180px",
      background: "#fff",
      border: "1px solid #e2e8f0",
      borderRadius: 8,
      padding: "16px 20px",
      minWidth: 0,
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color: accent ?? "#1e3a5f", lineHeight: 1.2 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function CurrencyTotals({ totals }: { totals: { currency: string; total: string }[] }) {
  if (totals.length === 0) return <span style={{ color: "#94a3b8" }}>—</span>;
  return (
    <span>
      {totals.map((t, i) => (
        <span key={t.currency}>
          {i > 0 && <br />}
          {t.currency} {t.total}
        </span>
      ))}
    </span>
  );
}

export default async function CashFlowPage() {
  const today = todayString();
  const db = getDb();

  const [company] = await db.select({ baseCurrency: companies.baseCurrency }).from(companies).limit(1);
  const baseCurrency = company?.baseCurrency ?? "EUR";

  const rows = await db
    .select({
      id: supplierInvoices.id,
      vendorName: vendors.name,
      invoiceNumber: supplierInvoices.invoiceNumber,
      invoiceDate: supplierInvoices.invoiceDate,
      dueDate: supplierInvoices.dueDate,
      currency: supplierInvoices.currency,
      currencyType: supplierInvoices.currencyType,
      grossAmount: supplierInvoices.grossAmount,
      baseGrossAmount: supplierInvoices.baseGrossAmount,
      status: supplierInvoices.status,
      paymentStatus: supplierInvoices.paymentStatus,
    })
    .from(supplierInvoices)
    .leftJoin(vendors, eq(supplierInvoices.vendorId, vendors.id))
    .where(eq(supplierInvoices.paymentStatus, "Unpaid"))
    .orderBy(desc(supplierInvoices.createdAt));

  type Row = typeof rows[number];

  const classified = rows.map((r) => ({
    ...r,
    bucket: classifyBucket(r.dueDate, today) as Bucket,
    dueThisMonth: isDueThisMonth(r.dueDate, today),
  }));

  // Summary totals
  const allTotals = sumByCurrency(classified);
  const overdueTotals = sumByCurrency(classified.filter((r) => r.bucket === "overdue"));
  const thisMonthTotals = sumByCurrency(classified.filter((r) => r.dueThisMonth));
  const missingCount = classified.filter((r) => r.bucket === "missing").length;

  // 4-week data for client component
  const weeks: WeekData[] = ([1, 2, 3, 4] as const).map((w) => {
    const range = getWeekDateRange(today, w);
    const bucket = (`week${w}` as Bucket);
    const invoices = classified
      .filter((r) => r.bucket === bucket)
      .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))
      .map((r): WeeklyInvoice => ({
        id: r.id,
        vendorName: r.vendorName,
        invoiceNumber: r.invoiceNumber,
        dueDate: r.dueDate,
        currency: r.currency,
        currencyType: r.currencyType,
        grossAmount: r.grossAmount,
      }));
    return {
      label: BUCKET_LABELS[bucket],
      dateRange: `${formatShortDate(range.start)} – ${formatShortDate(range.end)}`,
      invoices,
      currencyTotals: sumByCurrency(invoices),
    };
  });

  const overdueData: OverdueData = {
    invoices: classified
      .filter((r) => r.bucket === "overdue")
      .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))
      .map((r): WeeklyInvoice => ({
        id: r.id,
        vendorName: r.vendorName,
        invoiceNumber: r.invoiceNumber,
        dueDate: r.dueDate,
        currency: r.currency,
        currencyType: r.currencyType,
        grossAmount: r.grossAmount,
      })),
    currencyTotals: overdueTotals,
  };

  // Sort payables table: overdue first, then by due date, then missing
  const sortedForTable = [...classified].sort((a, b) => {
    const bucketOrder: Record<Bucket, number> = {
      overdue: 0, week1: 1, week2: 2, week3: 3, week4: 4, later: 5, missing: 6,
    };
    const bo = bucketOrder[a.bucket] - bucketOrder[b.bucket];
    if (bo !== 0) return bo;
    return (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999");
  });

  return (
    <div>
      <div style={{ marginBottom: 24, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#1e3a5f", margin: 0 }}>
          Cash Forecast
        </h1>
        <form action="/api/cash-flow/export" method="get">
          <button
            type="submit"
            style={{ border: "1px solid #cbd5e1", color: "#334155", background: "#fff", padding: "8px 18px", borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: "pointer" }}
          >
            Export payables
          </button>
        </form>
      </div>

      {/* Current-month funding summary */}
      <section style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#64748b", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Current month funding — {today.slice(0, 7)}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <SummaryCard
            label="Total outstanding"
            value={<CurrencyTotals totals={allTotals} />}
            sub={`${classified.length} invoice${classified.length === 1 ? "" : "s"}`}
          />
          <SummaryCard
            label="Due this month"
            value={<CurrencyTotals totals={thisMonthTotals} />}
            accent="#0891b2"
            sub="current calendar month, not yet overdue"
          />
          <SummaryCard
            label="Overdue"
            value={<CurrencyTotals totals={overdueTotals} />}
            accent="#dc2626"
            sub={`${overdueData.invoices.length} invoice${overdueData.invoices.length === 1 ? "" : "s"} past due`}
          />
          <SummaryCard
            label="Due date missing"
            value={<span style={{ color: missingCount > 0 ? "#d97706" : "#94a3b8" }}>{missingCount}</span>}
            sub={missingCount > 0 ? "cannot assign to payment bucket" : "all invoices have due dates"}
          />
        </div>
        {allTotals.length > 1 && (
          <p style={{ marginTop: 10, fontSize: 12, color: "#94a3b8" }}>
            Totals shown per currency. Base currency ({baseCurrency}) conversion is not applied — use stored base amounts in the export.
          </p>
        )}
      </section>

      {/* Next 4 weeks */}
      <section style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#64748b", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Next 4 weeks
        </div>
        {classified.length === 0 ? (
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "32px 24px", textAlign: "center", color: "#94a3b8" }}>
            No outstanding payables.
          </div>
        ) : (
          <CashFlowView weeks={weeks} overdue={overdueData} />
        )}
      </section>

      {/* Outstanding payables table */}
      <section>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#64748b", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Outstanding payables ({classified.length})
        </div>

        {classified.length === 0 ? (
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "48px 24px", textAlign: "center", color: "#718096" }}>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>No outstanding payables</div>
            <div>All supplier invoices are paid or there are no invoices yet.</div>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div style={{ display: "none" }} className="cf-table-desktop">
              <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, overflow: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
                  <thead>
                    <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                      {["Vendor", "Invoice No.", "Inv. Date", "Due Date", "Currency", "Gross Amount", "Approval", "Timing"].map((h) => (
                        <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedForTable.map((inv, i) => (
                      <tr key={inv.id} style={{ borderBottom: i < sortedForTable.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                        <td style={{ padding: "11px 14px" }}>
                          <Link href={`/invoices/${inv.id}`} style={{ color: "#2563eb", textDecoration: "none", fontWeight: 500, fontSize: 13 }}>
                            {inv.vendorName ?? <span style={{ color: "#94a3b8" }}>—</span>}
                          </Link>
                        </td>
                        <td style={{ padding: "11px 14px", fontSize: 13, color: "#475569" }}>
                          {inv.invoiceNumber ?? <span style={{ color: "#94a3b8" }}>—</span>}
                        </td>
                        <td style={{ padding: "11px 14px", fontSize: 13, color: "#64748b" }}>
                          {inv.invoiceDate ?? "—"}
                        </td>
                        <td style={{ padding: "11px 14px", fontSize: 13 }}>
                          {inv.dueDate ? (
                            <span style={{ color: inv.bucket === "overdue" ? "#dc2626" : "#334155", fontWeight: inv.bucket === "overdue" ? 600 : 400 }}>
                              {inv.dueDate}
                            </span>
                          ) : (
                            <span style={{ color: "#d97706", fontWeight: 600, fontSize: 12 }}>Due date missing</span>
                          )}
                        </td>
                        <td style={{ padding: "11px 14px", fontSize: 13, color: "#64748b" }}>{inv.currency}</td>
                        <td style={{ padding: "11px 14px", fontWeight: 600, fontSize: 13 }}>
                          {inv.grossAmount ? formatDisplayAmount(inv.grossAmount, inv.currencyType) : "—"}
                        </td>
                        <td style={{ padding: "11px 14px" }}>{approvalBadge(inv.status)}</td>
                        <td style={{ padding: "11px 14px" }}>
                          <span style={{
                            padding: "2px 8px",
                            borderRadius: 10,
                            fontSize: 11,
                            fontWeight: 600,
                            background: inv.bucket === "overdue" ? "#fee2e2" : inv.bucket === "missing" ? "#fef9c3" : "#eff6ff",
                            color: inv.bucket === "overdue" ? "#dc2626" : inv.bucket === "missing" ? "#713f12" : "#1e40af",
                          }}>
                            {BUCKET_LABELS[inv.bucket]}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Mobile stacked cards */}
            <div className="cf-table-mobile">
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {sortedForTable.map((inv) => (
                  <div key={inv.id} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "14px 16px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 6 }}>
                      <Link href={`/invoices/${inv.id}`} style={{ color: "#2563eb", textDecoration: "none", fontWeight: 600, fontSize: 14 }}>
                        {inv.vendorName ?? "Unknown vendor"}
                      </Link>
                      <span style={{ fontWeight: 700, fontSize: 14, whiteSpace: "nowrap" }}>
                        {inv.currency} {inv.grossAmount ? formatDisplayAmount(inv.grossAmount, inv.currencyType) : "—"}
                      </span>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", fontSize: 12, color: "#64748b" }}>
                      {inv.invoiceNumber && <span>#{inv.invoiceNumber}</span>}
                      {inv.invoiceDate && <span>Inv: {inv.invoiceDate}</span>}
                      <span style={{ color: inv.bucket === "overdue" ? "#dc2626" : inv.bucket === "missing" ? "#d97706" : "#64748b", fontWeight: (inv.bucket === "overdue" || inv.bucket === "missing") ? 600 : 400 }}>
                        {inv.dueDate ? `Due: ${inv.dueDate}` : "Due date missing"}
                      </span>
                    </div>
                    <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {approvalBadge(inv.status)}
                      <span style={{
                        padding: "2px 8px",
                        borderRadius: 10,
                        fontSize: 11,
                        fontWeight: 600,
                        background: inv.bucket === "overdue" ? "#fee2e2" : inv.bucket === "missing" ? "#fef9c3" : "#eff6ff",
                        color: inv.bucket === "overdue" ? "#dc2626" : inv.bucket === "missing" ? "#713f12" : "#1e40af",
                      }}>
                        {BUCKET_LABELS[inv.bucket]}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
