"use client";
import { useState } from "react";
import Link from "next/link";
import type { CurrencyTotal } from "@/src/lib/cash-flow-buckets";
import { useI18n } from "@/src/i18n/context";

export interface WeeklyInvoice {
  id: number;
  vendorName: string | null;
  invoiceNumber: string | null;
  dueDate: string | null;
  currency: string;
  currencyType: "fiat" | "crypto";
  grossAmount: string | null;
}

export interface WeekData {
  label: string;
  dateRange: string;
  invoices: WeeklyInvoice[];
  currencyTotals: CurrencyTotal[];
}

export interface OverdueData {
  invoices: WeeklyInvoice[];
  currencyTotals: CurrencyTotal[];
}

function formatAmount(amount: string | null, currencyType: "fiat" | "crypto"): string {
  if (!amount) return "—";
  try {
    const n = parseFloat(amount);
    if (currencyType === "crypto") return amount.replace(/\.?0+$/, "");
    return n.toFixed(2);
  } catch {
    return amount;
  }
}

function InvoiceDetailRow({ inv }: { inv: WeeklyInvoice }) {
  const { t } = useI18n();
  const cf = t.cashFlow;
  return (
    <div style={{
      display: "flex",
      flexWrap: "wrap",
      gap: "4px 16px",
      padding: "8px 0",
      borderBottom: "1px solid #f1f5f9",
      alignItems: "baseline",
    }}>
      <Link
        href={`/invoices/${inv.id}`}
        style={{ color: "#2563eb", fontWeight: 500, textDecoration: "none", fontSize: 13 }}
      >
        {inv.vendorName ?? <span style={{ color: "#94a3b8" }}>{cf.unknownVendor}</span>}
      </Link>
      <span style={{ color: "#64748b", fontSize: 12 }}>
        {inv.invoiceNumber ?? "—"}
      </span>
      <span style={{ color: "#64748b", fontSize: 12 }}>
        {cf.mobileDue} {inv.dueDate ?? "—"}
      </span>
      <span style={{ fontWeight: 600, fontSize: 13, marginLeft: "auto" }}>
        {inv.currency} {formatAmount(inv.grossAmount, inv.currencyType)}
      </span>
    </div>
  );
}

function CurrencyTotalList({ totals }: { totals: CurrencyTotal[] }) {
  if (totals.length === 0) return <span style={{ color: "#94a3b8" }}>—</span>;
  if (totals.length === 1) {
    return (
      <span style={{ fontWeight: 700 }}>
        {totals[0].currency} {totals[0].total}
      </span>
    );
  }
  return (
    <span>
      {totals.map((t, i) => (
        <span key={t.currency}>
          {i > 0 && <span style={{ color: "#94a3b8", margin: "0 4px" }}>·</span>}
          <span style={{ fontWeight: 700 }}>{t.currency} {t.total}</span>
        </span>
      ))}
    </span>
  );
}

function WeekCard({
  label,
  dateRange,
  invoices,
  currencyTotals,
  accent,
}: WeekData & { accent: string }) {
  const { t } = useI18n();
  const cf = t.cashFlow;
  const [open, setOpen] = useState(false);
  const count = invoices.length;

  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff", overflow: "hidden" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={count === 0}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 16px",
          background: "transparent",
          border: "none",
          cursor: count === 0 ? "default" : "pointer",
          textAlign: "left",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: accent }}>{label}</span>
          <span style={{ fontSize: 11, color: "#94a3b8" }}>{dateRange}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 15 }}>
              <CurrencyTotalList totals={currencyTotals} />
            </div>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>
              {count === 0 ? cf.noInvoices : `${count} invoice${count === 1 ? "" : "s"}`}
            </div>
          </div>
          {count > 0 && (
            <span style={{ color: "#94a3b8", fontSize: 16, userSelect: "none" }}>
              {open ? "▲" : "▼"}
            </span>
          )}
        </div>
      </button>

      {open && count > 0 && (
        <div style={{ borderTop: "1px solid #f1f5f9", padding: "0 16px 8px" }}>
          {invoices.map((inv) => (
            <InvoiceDetailRow key={inv.id} inv={inv} />
          ))}
        </div>
      )}
    </div>
  );
}

function OverdueCard({ overdue }: { overdue: OverdueData }) {
  const { t } = useI18n();
  const cf = t.cashFlow;
  const [open, setOpen] = useState(false);
  const count = overdue.invoices.length;

  return (
    <div style={{ border: "1px solid #fca5a5", borderRadius: 8, background: "#fff7f7", overflow: "hidden" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={count === 0}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 16px",
          background: "transparent",
          border: "none",
          cursor: count === 0 ? "default" : "pointer",
          textAlign: "left",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: "#dc2626" }}>{cf.bucketOverdue}</span>
          <span style={{ fontSize: 11, color: "#f87171" }}>{cf.paymentPastDue}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 15, color: "#dc2626" }}>
              <CurrencyTotalList totals={overdue.currencyTotals} />
            </div>
            <div style={{ fontSize: 11, color: "#f87171" }}>
              {count === 0 ? cf.noneLabel : `${count} invoice${count === 1 ? "" : "s"}`}
            </div>
          </div>
          {count > 0 && (
            <span style={{ color: "#f87171", fontSize: 16, userSelect: "none" }}>
              {open ? "▲" : "▼"}
            </span>
          )}
        </div>
      </button>

      {open && count > 0 && (
        <div style={{ borderTop: "1px solid #fca5a5", padding: "0 16px 8px" }}>
          {overdue.invoices.map((inv) => (
            <InvoiceDetailRow key={inv.id} inv={inv} />
          ))}
        </div>
      )}
    </div>
  );
}

const WEEK_ACCENTS = ["#2563eb", "#0891b2", "#059669", "#7c3aed"];

export default function CashFlowView({
  weeks,
  overdue,
}: {
  weeks: WeekData[];
  overdue: OverdueData;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <OverdueCard overdue={overdue} />
      {weeks.map((week, i) => (
        <WeekCard key={week.label} {...week} accent={WEEK_ACCENTS[i] ?? "#1e3a5f"} />
      ))}
    </div>
  );
}
