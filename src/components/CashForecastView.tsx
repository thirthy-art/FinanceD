"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Decimal } from "@/src/lib/decimal";
import { useI18n } from "@/src/i18n/context";
import type {
  CashForecastCategory,
  CashForecastDirection,
  CashForecastResult,
  ForecastManualItem,
} from "@/src/lib/cash-forecast";

interface Props {
  currency: string;
  openingCash: string;
  minimumBuffer: string;
  forecast: CashForecastResult;
  items: ForecastManualItem[];
}

function display(value: string): string {
  try { return new Decimal(value).toFixed(2); } catch { return value; }
}

const EMPTY_ITEM = {
  date: "", description: "", direction: "outflow" as CashForecastDirection,
  category: "payroll" as CashForecastCategory, amount: "",
};

export default function CashForecastView(props: Props) {
  const { t } = useI18n();
  const f = t.cashForecast;
  const router = useRouter();
  const [openingCash, setOpeningCash] = useState(props.openingCash);
  const [minimumBuffer, setMinimumBuffer] = useState(props.minimumBuffer);
  const [form, setForm] = useState(EMPTY_ITEM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const categoryLabels: Record<CashForecastCategory, string> = {
    customer_receipts: f.customerReceipts, financing_inflow: f.financingInflow,
    other_inflow: f.otherInflow, payroll: f.payroll, tax_vat: f.taxVat,
    rent: f.rent, debt_service: f.debtService, other_outflow: f.otherOutflow,
  };
  const categories: CashForecastCategory[] = form.direction === "inflow"
    ? ["customer_receipts", "financing_inflow", "other_inflow"]
    : ["payroll", "tax_vat", "rent", "debt_service", "other_outflow"];

  async function request(url: string, method: string, body?: unknown) {
    setBusy(true); setError("");
    try {
      const response = await fetch(url, {
        method, headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) throw new Error("request failed");
      router.refresh();
      return true;
    } catch {
      setError(method === "DELETE" ? f.deleteFailed : f.saveFailed);
      return false;
    } finally { setBusy(false); }
  }

  async function saveSettings(event: React.FormEvent) {
    event.preventDefault();
    await request("/api/cash-flow/forecast/settings", "PUT", { openingCashBalance: openingCash, minimumCashBuffer: minimumBuffer });
  }

  async function saveItem(event: React.FormEvent) {
    event.preventDefault();
    const ok = await request(
      editingId ? `/api/cash-flow/forecast/items/${editingId}` : "/api/cash-flow/forecast/items",
      editingId ? "PUT" : "POST", form,
    );
    if (ok) { setForm(EMPTY_ITEM); setEditingId(null); }
  }

  function startEdit(item: ForecastManualItem) {
    setEditingId(item.id);
    setForm({ date: item.date, description: item.description, direction: item.direction, category: item.category, amount: item.amount });
  }

  const lowestWeek = props.forecast.weeks[props.forecast.lowestWeekIndex];
  const breach = props.forecast.firstBufferBreachWeekIndex === null
    ? null : props.forecast.weeks[props.forecast.firstBufferBreachWeekIndex];

  const inputStyle = { border: "1px solid #cbd5e1", borderRadius: 6, padding: "8px 10px", fontSize: 14, minWidth: 0 };
  const cardStyle = { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 16 };

  return <div>
    <h2 style={{ fontSize: 20, color: "#1e3a5f", margin: "0 0 6px" }}>{f.title}</h2>
    <p style={{ margin: "0 0 18px", color: "#64748b", fontSize: 13 }}>{f.manualNotice}</p>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(165px, 1fr))", gap: 10, marginBottom: 16 }}>
      {[
        [f.openingCash, props.openingCash, ""],
        [f.week13Closing, props.forecast.projectedClosingCash, ""],
        [f.lowestCash, props.forecast.lowestProjectedCash, `${f.week} ${lowestWeek.index + 1}: ${lowestWeek.start} – ${lowestWeek.end}`],
        [f.minimumBuffer, props.minimumBuffer, ""],
      ].map(([label, value, note]) => <div key={label} style={cardStyle}>
        <div style={{ color: "#64748b", fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}>{label}</div>
        <div style={{ color: "#1e3a5f", fontSize: 19, fontWeight: 700, marginTop: 5 }}>{props.currency} {display(value)}</div>
        {note && <div style={{ color: "#94a3b8", fontSize: 11, marginTop: 4 }}>{note}</div>}
      </div>)}
    </div>

    {breach && <div style={{ background: "#fff7ed", border: "1px solid #fdba74", color: "#9a3412", borderRadius: 7, padding: 12, marginBottom: 10 }}>
      {f.bufferWarning.replace("{week}", String(breach.index + 1)).replace("{range}", `${breach.start} – ${breach.end}`)}
    </div>}
    {props.forecast.missingDueDateCount > 0 && <div style={{ color: "#92400e", fontSize: 13, marginBottom: 5 }}>{f.missingDueWarning.replace("{count}", String(props.forecast.missingDueDateCount))}</div>}
    {props.forecast.missingBaseAmountCount > 0 && <div style={{ color: "#92400e", fontSize: 13, marginBottom: 5 }}>{f.missingBaseWarning.replace("{count}", String(props.forecast.missingBaseAmountCount))}</div>}

    <form onSubmit={saveSettings} style={{ ...cardStyle, margin: "18px 0" }}>
      <div style={{ fontWeight: 700, color: "#334155", marginBottom: 10 }}>{f.settingsTitle}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "end" }}>
        <label style={{ display: "grid", gap: 4, flex: "1 1 180px", fontSize: 12 }}>{f.openingCash} ({props.currency})<input required value={openingCash} onChange={(e) => setOpeningCash(e.target.value)} style={inputStyle} inputMode="decimal" /></label>
        <label style={{ display: "grid", gap: 4, flex: "1 1 180px", fontSize: 12 }}>{f.minimumBuffer} ({props.currency})<input required value={minimumBuffer} onChange={(e) => setMinimumBuffer(e.target.value)} style={inputStyle} inputMode="decimal" /></label>
        <button disabled={busy} style={{ background: "#1e3a5f", color: "white", border: 0, borderRadius: 6, padding: "9px 16px", fontWeight: 600 }}>{f.saveSettings}</button>
      </div>
    </form>

    <form onSubmit={saveItem} style={{ ...cardStyle, marginBottom: 18 }}>
      <div style={{ fontWeight: 700, color: "#334155", marginBottom: 10 }}>{editingId ? f.editItem : f.addItem}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        <label style={{ display: "grid", gap: 4, fontSize: 12 }}>{f.date}<input type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} style={inputStyle} /></label>
        <label style={{ display: "grid", gap: 4, fontSize: 12 }}>{f.description}<input required maxLength={200} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} style={inputStyle} /></label>
        <label style={{ display: "grid", gap: 4, fontSize: 12 }}>{f.direction}<select value={form.direction} onChange={(e) => {
          const direction = e.target.value as CashForecastDirection;
          setForm({ ...form, direction, category: direction === "inflow" ? "customer_receipts" : "payroll" });
        }} style={inputStyle}><option value="inflow">{f.inflow}</option><option value="outflow">{f.outflow}</option></select></label>
        <label style={{ display: "grid", gap: 4, fontSize: 12 }}>{f.category}<select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as CashForecastCategory })} style={inputStyle}>{categories.map((category) => <option key={category} value={category}>{categoryLabels[category]}</option>)}</select></label>
        <label style={{ display: "grid", gap: 4, fontSize: 12 }}>{f.amount} ({props.currency})<input required inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} style={inputStyle} /></label>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}><button disabled={busy} style={{ background: "#2563eb", color: "white", border: 0, borderRadius: 6, padding: "8px 16px", fontWeight: 600 }}>{f.save}</button>
      {editingId && <button type="button" onClick={() => { setEditingId(null); setForm(EMPTY_ITEM); }} style={{ border: "1px solid #cbd5e1", background: "white", borderRadius: 6, padding: "8px 16px" }}>{f.cancel}</button>}</div>
      {error && <div style={{ color: "#b91c1c", marginTop: 8, fontSize: 13 }}>{error}</div>}
    </form>

    <section style={{ ...cardStyle, marginBottom: 18 }}>
      <div style={{ fontWeight: 700, color: "#334155", marginBottom: 8 }}>{f.plannedItems}</div>
      {props.items.length === 0 ? <div style={{ color: "#94a3b8", fontSize: 13 }}>{f.noPlannedItems}</div> : props.items.map((item) =>
        <div key={item.id} style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid #f1f5f9", fontSize: 13 }}>
          <span>{item.date} · {item.description} · {categoryLabels[item.category]}</span>
          <span>{item.direction === "inflow" ? "+" : "−"} {props.currency} {display(item.amount)} <button type="button" onClick={() => startEdit(item)} style={{ marginInlineStart: 8 }}>{f.edit}</button> <button type="button" disabled={busy} onClick={() => request(`/api/cash-flow/forecast/items/${item.id}`, "DELETE")} style={{ marginInlineStart: 4 }}>{f.delete}</button></span>
        </div>
      )}
    </section>

    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      {props.forecast.weeks.map((week) => <details key={week.index} style={{ background: "#fff", border: `1px solid ${breach && week.index >= breach.index ? "#fdba74" : "#e2e8f0"}`, borderRadius: 8, overflow: "hidden" }}>
        <summary style={{ padding: 14, cursor: "pointer", fontWeight: 700, color: "#334155" }}>{f.week} {week.index + 1} · {week.start} – {week.end} · {f.closingCash}: {props.currency} {display(week.closingCash)}</summary>
        <div style={{ padding: "0 14px 14px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8, marginBottom: 12 }}>
            {[[f.openingCash, week.openingCash], [f.manualInflows, week.manualInflows], [f.apOutflows, week.apOutflows], [f.manualOutflows, week.manualOutflows], [f.netMovement, week.netMovement], [f.closingCash, week.closingCash]].map(([label, value]) => <div key={label} style={{ background: "#f8fafc", padding: 9, borderRadius: 5 }}><div style={{ color: "#64748b", fontSize: 11 }}>{label}</div><strong>{props.currency} {display(value)}</strong></div>)}
          </div>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 5 }}>{f.details}</div>
          {week.apItems.length === 0 && week.manualItems.length === 0 ? <div style={{ color: "#94a3b8", fontSize: 13 }}>{f.noItems}</div> : <div>
            {week.apItems.map((item) => <div key={`ap-${item.id}`} style={{ display: "flex", gap: 8, justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #f1f5f9", fontSize: 13 }}><Link href={`/invoices/${item.id}`}>{item.vendorName || item.invoiceNumber || `#${item.id}`}</Link><span>− {props.currency} {display(item.baseGrossAmount!)}</span></div>)}
            {week.manualItems.map((item) => <div key={`manual-${item.id}`} style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #f1f5f9", fontSize: 13 }}><span>{item.date} · {item.description} · {categoryLabels[item.category]}</span><span>{item.direction === "inflow" ? "+" : "−"} {props.currency} {display(item.amount)} <button onClick={() => startEdit(item)} style={{ marginInlineStart: 8 }}>{f.edit}</button> <button onClick={() => request(`/api/cash-flow/forecast/items/${item.id}`, "DELETE")} style={{ marginInlineStart: 4 }}>{f.delete}</button></span></div>)}
          </div>}
        </div>
      </details>)}
    </div>
  </div>;
}
