"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { isAmountMismatch, toDecimal } from "@/src/lib/invoice-validation";

interface Vendor { id: number; name: string; }
interface CostCentre { id: number; code: string; name: string; }
interface Account { id: number; code: string; name: string; type: string; isActive: boolean; }
interface Document { id: number; mimeType: string; originalFilename: string; ocrPerformed: boolean; }
interface Invoice {
  id: number;
  vendorId: number | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  currency: string;
  currencyType: "fiat" | "crypto";
  fxRateToBase: string | null;
  netAmount: string | null;
  vatAmount: string | null;
  grossAmount: string | null;
  costCentreId: number | null;
  expenseAccountId: number | null;
  notes: string | null;
  status: "draft" | "approved";
}

interface Props {
  invoice: Invoice;
  documents: Document[];
  vendors: Vendor[];
  costCentres: CostCentre[];
  accounts: Account[];
  extractedFields: Record<string, string>;
}

const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "CAD", "AUD", "JPY", "SEK", "NOK", "DKK", "RON", "BTC", "ETH", "USDT", "USDC"];

function field(label: string, children: React.ReactNode, hint?: string) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </label>
      {children}
      {hint && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 3 }}>{hint}</div>}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid #e2e8f0",
  borderRadius: 6,
  fontSize: 14,
  background: "#fff",
  color: "#1a202c",
};

const warnStyle: React.CSSProperties = {
  ...inputStyle,
  borderColor: "#f59e0b",
  background: "#fffbeb",
};

export default function InvoiceReview({ invoice, documents, vendors, costCentres, accounts, extractedFields }: Props) {
  const router = useRouter();
  const [form, setForm] = useState({
    vendorId: invoice.vendorId ? String(invoice.vendorId) : "",
    newVendorName: "",
    invoiceNumber: invoice.invoiceNumber ?? extractedFields.invoiceNumber ?? "",
    invoiceDate: invoice.invoiceDate ?? extractedFields.invoiceDate ?? "",
    dueDate: invoice.dueDate ?? extractedFields.dueDate ?? "",
    currency: invoice.currency ?? extractedFields.currency ?? "EUR",
    currencyType: invoice.currencyType ?? "fiat" as "fiat" | "crypto",
    fxRateToBase: invoice.fxRateToBase ?? "1",
    netAmount: invoice.netAmount ?? extractedFields.netAmount ?? "",
    vatAmount: invoice.vatAmount ?? extractedFields.vatAmount ?? "",
    grossAmount: invoice.grossAmount ?? extractedFields.grossAmount ?? "",
    costCentreId: invoice.costCentreId ? String(invoice.costCentreId) : "",
    expenseAccountId: invoice.expenseAccountId ? String(invoice.expenseAccountId) : "",
    notes: invoice.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(false);
  const [addVendor, setAddVendor] = useState(false);

  const doc = documents[0];

  // Arithmetic validation using decimal strings
  const mismatch = isAmountMismatch(
    form.netAmount, form.vatAmount, form.grossAmount, form.currencyType
  );
  const computedSum = form.netAmount || form.vatAmount
    ? toDecimal(form.netAmount).plus(toDecimal(form.vatAmount)).toFixed()
    : "";
  const grossDisplay = form.grossAmount
    ? toDecimal(form.grossAmount).toFixed()
    : "";

  function set(k: string) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      setForm((f) => ({ ...f, [k]: e.target.value }));
      setSaved(false);
    };
  }

  async function save(status: "draft" | "approved") {
    setSaving(true);
    setSaveError("");
    try {
      const body: Record<string, unknown> = {
        invoiceNumber: form.invoiceNumber || null,
        invoiceDate: form.invoiceDate || null,
        dueDate: form.dueDate || null,
        currency: form.currency,
        currencyType: form.currencyType,
        fxRateToBase: form.fxRateToBase || null,
        netAmount: form.netAmount || null,
        vatAmount: form.vatAmount || null,
        grossAmount: form.grossAmount || null,
        costCentreId: form.costCentreId ? Number(form.costCentreId) : null,
        expenseAccountId: form.expenseAccountId ? Number(form.expenseAccountId) : null,
        notes: form.notes || null,
        status,
      };
      if (addVendor && form.newVendorName) {
        body.newVendorName = form.newVendorName;
        body.vendorId = null;
      } else if (form.vendorId) {
        body.vendorId = Number(form.vendorId);
      }

      const res = await fetch(`/api/invoices/${invoice.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(json.error));
      setSaved(true);
      if (status === "approved") router.push("/");
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const expenseAccounts = accounts.filter((a) => a.type === "expense" && a.isActive);

  return (
    <div style={{ display: "flex", gap: 24, alignItems: "flex-start", minHeight: "calc(100vh - 100px)" }}>
      {/* Document preview */}
      <div
        style={{
          flex: "0 0 48%",
          background: "#fff",
          border: "1px solid #e2e8f0",
          borderRadius: 8,
          overflow: "hidden",
          position: "sticky",
          top: 16,
          maxHeight: "calc(100vh - 80px)",
        }}
      >
        <div
          style={{
            padding: "12px 16px",
            background: "#f8fafc",
            borderBottom: "1px solid #e2e8f0",
            fontSize: 13,
            fontWeight: 600,
            color: "#475569",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>Original Document</span>
          {doc && (
            <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 400 }}>
              {doc.ocrPerformed ? "OCR applied" : "Text extracted"} · {doc.originalFilename}
            </span>
          )}
        </div>
        {doc ? (
          doc.mimeType === "application/pdf" ? (
            <iframe
              src={`/api/invoices/${invoice.id}/document`}
              style={{ width: "100%", height: "calc(100vh - 150px)", border: "none" }}
              title="Invoice document"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/invoices/${invoice.id}/document`}
              alt="Invoice document"
              style={{ width: "100%", objectFit: "contain", maxHeight: "calc(100vh - 150px)" }}
            />
          )
        ) : (
          <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>
            No document attached
          </div>
        )}
      </div>

      {/* Editable fields */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            background: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            padding: 24,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "#1e3a5f" }}>Invoice Details</h2>
            <span
              style={{
                padding: "3px 12px",
                borderRadius: 12,
                fontSize: 12,
                fontWeight: 600,
                background: invoice.status === "approved" ? "#dcfce7" : "#fef9c3",
                color: invoice.status === "approved" ? "#166534" : "#713f12",
              }}
            >
              {invoice.status}
            </span>
          </div>

          {/* Vendor */}
          {field(
            "Vendor",
            <>
              {!addVendor ? (
                <div style={{ display: "flex", gap: 8 }}>
                  <select style={{ ...inputStyle, flex: 1 }} value={form.vendorId} onChange={set("vendorId")}>
                    <option value="">— select vendor —</option>
                    {vendors.map((v) => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => setAddVendor(true)}
                    style={{ padding: "8px 12px", border: "1px solid #e2e8f0", borderRadius: 6, background: "#f8fafc", cursor: "pointer", fontSize: 13 }}
                    type="button"
                  >
                    + New
                  </button>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    style={{ ...inputStyle, flex: 1 }}
                    placeholder="Vendor name"
                    value={form.newVendorName}
                    onChange={set("newVendorName")}
                  />
                  <button
                    onClick={() => setAddVendor(false)}
                    style={{ padding: "8px 12px", border: "1px solid #e2e8f0", borderRadius: 6, background: "#f8fafc", cursor: "pointer", fontSize: 13 }}
                    type="button"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </>
          )}

          {/* Invoice number + date */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {field("Invoice Number", <input style={inputStyle} value={form.invoiceNumber} onChange={set("invoiceNumber")} placeholder="INV-001" />)}
            {field("Invoice Date", <input style={inputStyle} type="date" value={form.invoiceDate} onChange={set("invoiceDate")} />)}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {field("Due Date (optional)", <input style={inputStyle} type="date" value={form.dueDate} onChange={set("dueDate")} />)}
            {field(
              "Currency",
              <div style={{ display: "flex", gap: 8 }}>
                <select style={{ ...inputStyle, flex: 1 }} value={form.currency} onChange={set("currency")}>
                  {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
                </select>
                <input
                  style={{ ...inputStyle, flex: 1 }}
                  value={form.currency}
                  onChange={set("currency")}
                  placeholder="Or type code"
                  title="Type a currency or asset code not in the list"
                />
              </div>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {field(
              "Currency Type",
              <select style={inputStyle} value={form.currencyType} onChange={set("currencyType")}>
                <option value="fiat">Fiat</option>
                <option value="crypto">Crypto</option>
              </select>,
              "Affects validation tolerance and display formatting"
            )}
            {field(
              "FX Rate to Base",
              <input style={inputStyle} value={form.fxRateToBase} onChange={set("fxRateToBase")} placeholder="1" />,
              "1 unit of invoice currency = ? units of base currency"
            )}
          </div>

          {/* Amounts */}
          <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Amounts ({form.currency})
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, color: "#64748b", marginBottom: 4 }}>Net Amount</label>
                <input style={inputStyle} value={form.netAmount} onChange={set("netAmount")} placeholder="0.00" />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, color: "#64748b", marginBottom: 4 }}>VAT Amount</label>
                <input style={inputStyle} value={form.vatAmount} onChange={set("vatAmount")} placeholder="0.00" />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, color: "#64748b", marginBottom: 4 }}>
                  Gross Amount
                  {mismatch && " !!"}
                </label>
                <input style={mismatch ? warnStyle : inputStyle} value={form.grossAmount} onChange={set("grossAmount")} placeholder="0.00" />
              </div>
            </div>
            {mismatch && (
              <div
                style={{
                  marginTop: 10,
                  padding: "8px 12px",
                  background: "#fffbeb",
                  border: "1px solid #fde68a",
                  borderRadius: 6,
                  fontSize: 13,
                  color: "#92400e",
                }}
              >
                Net + VAT = {computedSum} but Gross = {grossDisplay}
                {form.currencyType === "fiat"
                  ? " (difference exceeds 0.01 tolerance). Please verify."
                  : " (crypto amounts must match exactly). Please verify."}
              </div>
            )}
          </div>

          {/* Cost centre + account */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {field(
              "Cost Centre (optional)",
              <select style={inputStyle} value={form.costCentreId} onChange={set("costCentreId")}>
                <option value="">— none —</option>
                {costCentres.map((c) => (
                  <option key={c.id} value={c.id}>{c.code} · {c.name}</option>
                ))}
              </select>
            )}
            {field(
              "Expense Account (optional)",
              <select style={inputStyle} value={form.expenseAccountId} onChange={set("expenseAccountId")}>
                <option value="">— none —</option>
                {expenseAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
                ))}
              </select>
            )}
          </div>

          {field(
            "Notes",
            <textarea
              style={{ ...inputStyle, minHeight: 64, resize: "vertical" }}
              value={form.notes}
              onChange={set("notes")}
              placeholder="Any additional notes..."
            />
          )}

          {saveError && (
            <div style={{ marginBottom: 16, padding: "10px 14px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, color: "#dc2626", fontSize: 13 }}>
              {saveError}
            </div>
          )}
          {saved && (
            <div style={{ marginBottom: 16, padding: "10px 14px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6, color: "#16a34a", fontSize: 13 }}>
              Draft saved
            </div>
          )}

          <div style={{ display: "flex", gap: 12 }}>
            <button
              onClick={() => save("draft")}
              disabled={saving}
              style={{
                padding: "10px 20px",
                border: "1px solid #e2e8f0",
                borderRadius: 6,
                background: "#f8fafc",
                cursor: saving ? "default" : "pointer",
                fontSize: 14,
                fontWeight: 500,
              }}
            >
              Save Draft
            </button>
            <button
              onClick={() => save("approved")}
              disabled={saving || mismatch}
              title={mismatch ? "Fix amount mismatch before approving" : ""}
              style={{
                padding: "10px 20px",
                background: mismatch ? "#e2e8f0" : "#16a34a",
                color: mismatch ? "#94a3b8" : "#fff",
                border: "none",
                borderRadius: 6,
                cursor: saving || mismatch ? "default" : "pointer",
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              Approve Invoice
            </button>
          </div>
          {mismatch && (
            <div style={{ marginTop: 8, fontSize: 12, color: "#d97706" }}>
              Approve is disabled until the amount mismatch is resolved.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
