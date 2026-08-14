"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { safeIsAmountMismatch, safeCalculateBaseAmount, safeParseDecimal, formatDisplayAmount } from "@/src/lib/invoice-validation";
import type { MimoInvoiceExtraction } from "@/src/lib/mimo-extraction";

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
  baseNetAmount: string | null;
  baseVatAmount: string | null;
  baseGrossAmount: string | null;
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
  baseCurrency: string;
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

const readOnlyStyle: React.CSSProperties = {
  ...inputStyle,
  background: "#f8fafc",
  color: "#64748b",
};

const warnStyle: React.CSSProperties = {
  ...inputStyle,
  borderColor: "#f59e0b",
  background: "#fffbeb",
};

const errorInputStyle: React.CSSProperties = {
  ...inputStyle,
  borderColor: "#ef4444",
  background: "#fef2f2",
};

function validateMonetaryFields(form: { netAmount: string; vatAmount: string; grossAmount: string; fxRateToBase: string }): string[] {
  const fieldErrors: string[] = [];
  if (form.netAmount) {
    const r = safeParseDecimal(form.netAmount);
    if (r.error) fieldErrors.push(`Net: ${r.error}`);
  }
  if (form.vatAmount) {
    const r = safeParseDecimal(form.vatAmount);
    if (r.error) fieldErrors.push(`VAT: ${r.error}`);
  }
  if (form.grossAmount) {
    const r = safeParseDecimal(form.grossAmount);
    if (r.error) fieldErrors.push(`Gross: ${r.error}`);
  }
  if (form.fxRateToBase) {
    const r = safeParseDecimal(form.fxRateToBase);
    if (r.error) fieldErrors.push(`FX Rate: ${r.error}`);
  }
  return fieldErrors;
}

function extractionValue(value: string | number | null) {
  return value === null ? <span style={{ color: "#94a3b8" }}>—</span> : String(value);
}

function MimoExtractionPreview({ extraction }: { extraction: MimoInvoiceExtraction }) {
  const headerFields: Array<[string, string | null]> = [
    ["Vendor (original)", extraction.vendorOriginal],
    ["Vendor (English)", extraction.vendorNormalized],
    ["Invoice number", extraction.invoiceNumber],
    ["Invoice date", extraction.invoiceDate],
    ["Due date", extraction.dueDate],
    ["Currency", extraction.currency],
    ["Net amount", extraction.netAmount],
    ["VAT amount", extraction.vatAmount],
    ["Gross amount", extraction.grossAmount],
  ];

  const cellStyle: React.CSSProperties = {
    padding: "8px 10px",
    borderBottom: "1px solid #e2e8f0",
    verticalAlign: "top",
    fontSize: 12,
    whiteSpace: "nowrap",
  };

  return (
    <div style={{ background: "#fff", border: "1px solid #bfdbfe", borderRadius: 8, marginBottom: 16, overflow: "hidden" }}>
      <div style={{ padding: "14px 16px", background: "#eff6ff", borderBottom: "1px solid #bfdbfe" }}>
        <div style={{ fontWeight: 700, color: "#1e3a5f" }}>MiMo extraction preview</div>
        <div style={{ marginTop: 3, fontSize: 12, color: "#64748b" }}>
          Read-only AI output. Nothing below has been copied into the invoice fields or saved.
        </div>
      </div>

      <div style={{ padding: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 10 }}>
          Invoice header
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginBottom: 20 }}>
          {headerFields.map(([label, value]) => (
            <div key={label} style={{ background: "#f8fafc", borderRadius: 6, padding: "9px 10px", minWidth: 0 }}>
              <div style={{ color: "#64748b", fontSize: 10, fontWeight: 600, textTransform: "uppercase" }}>{label}</div>
              <div style={{ color: "#1e293b", fontSize: 13, marginTop: 3, overflowWrap: "anywhere" }}>{extractionValue(value)}</div>
            </div>
          ))}
        </div>

        <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 10 }}>
          Invoice lines ({extraction.lines.length})
        </div>
        {extraction.lines.length === 0 ? (
          <div style={{ color: "#64748b", fontSize: 13 }}>MiMo did not find any invoice lines.</div>
        ) : (
          <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 6 }}>
            <table style={{ borderCollapse: "collapse", minWidth: 1180, width: "100%", textAlign: "left" }}>
              <thead style={{ background: "#f8fafc", color: "#475569" }}>
                <tr>
                  {[
                    "#", "Line", "Description (original)", "Description (English)", "Qty", "Unit",
                    "Unit price", "Net", "VAT rate", "VAT", "Gross", "Page",
                  ].map((heading) => (
                    <th key={heading} style={{ ...cellStyle, fontWeight: 700 }}>{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {extraction.lines.map((line, index) => (
                  <tr key={`${line.lineNumber ?? "line"}-${index}`}>
                    <td style={cellStyle}>{index + 1}</td>
                    <td style={cellStyle}>{extractionValue(line.lineNumber)}</td>
                    <td style={{ ...cellStyle, minWidth: 220, whiteSpace: "normal" }}>{extractionValue(line.descriptionOriginal)}</td>
                    <td style={{ ...cellStyle, minWidth: 220, whiteSpace: "normal" }}>{extractionValue(line.description)}</td>
                    <td style={cellStyle}>{extractionValue(line.quantity)}</td>
                    <td style={cellStyle}>{extractionValue(line.unit)}</td>
                    <td style={cellStyle}>{extractionValue(line.unitPrice)}</td>
                    <td style={cellStyle}>{extractionValue(line.netAmount)}</td>
                    <td style={cellStyle}>{extractionValue(line.vatRate)}</td>
                    <td style={cellStyle}>{extractionValue(line.vatAmount)}</td>
                    <td style={cellStyle}>{extractionValue(line.grossAmount)}</td>
                    <td style={cellStyle}>{extractionValue(line.sourcePage)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function InvoiceReview({ invoice, documents, vendors, costCentres, accounts, extractedFields, baseCurrency }: Props) {
  const router = useRouter();
  const isApproved = invoice.status === "approved";
  const isSameCurrency = invoice.currency === baseCurrency;

  const [form, setForm] = useState({
    vendorId: invoice.vendorId ? String(invoice.vendorId) : "",
    newVendorName: "",
    invoiceNumber: invoice.invoiceNumber ?? extractedFields.invoiceNumber ?? "",
    invoiceDate: invoice.invoiceDate ?? extractedFields.invoiceDate ?? "",
    dueDate: invoice.dueDate ?? extractedFields.dueDate ?? "",
    currency: invoice.currency ?? extractedFields.currency ?? "EUR",
    currencyType: invoice.currencyType ?? "fiat" as "fiat" | "crypto",
    fxRateToBase: invoice.fxRateToBase ?? (isSameCurrency ? "1" : ""),
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
  const [extracting, setExtracting] = useState(false);
  const [extractionError, setExtractionError] = useState("");
  const [mimoExtraction, setMimoExtraction] = useState<MimoInvoiceExtraction | null>(null);

  const doc = documents[0];

  const currentIsSameCurrency = form.currency === baseCurrency;

  // Validate monetary fields defensively — never throws
  const inputErrors = validateMonetaryFields(form);
  const hasInputErrors = inputErrors.length > 0;

  // Arithmetic validation using safe helpers
  const mismatch = !hasInputErrors && safeIsAmountMismatch(
    form.netAmount, form.vatAmount, form.grossAmount, form.currencyType
  );

  // Compute display sum/gross safely
  let computedSum = "";
  let grossDisplay = "";
  if (!hasInputErrors) {
    try {
      const { toDecimal } = require("@/src/lib/invoice-validation");
      if (form.netAmount || form.vatAmount) {
        computedSum = toDecimal(form.netAmount).plus(toDecimal(form.vatAmount)).toFixed();
      }
      if (form.grossAmount) {
        grossDisplay = toDecimal(form.grossAmount).toFixed();
      }
    } catch {
      // silently degrade — do not throw during render
    }
  }

  // Compute preview base amounts for display using safe helpers
  const previewRate = currentIsSameCurrency ? "1" : (form.fxRateToBase || null);
  const previewBaseNet = safeCalculateBaseAmount(form.netAmount || null, previewRate);
  const previewBaseVat = safeCalculateBaseAmount(form.vatAmount || null, previewRate);
  const previewBaseGross = safeCalculateBaseAmount(form.grossAmount || null, previewRate);
  const showBaseAmounts = previewBaseNet !== null || previewBaseVat !== null || previewBaseGross !== null;

  function set(k: string) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      setForm((f) => ({ ...f, [k]: e.target.value }));
      setSaved(false);
    };
  }

  function handleCurrencyChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const newCurrency = e.target.value;
    setForm((f) => {
      if (newCurrency === baseCurrency) {
        return { ...f, currency: newCurrency, fxRateToBase: "1" };
      }
      // Any change to a foreign currency clears the rate
      if (newCurrency !== f.currency) {
        return { ...f, currency: newCurrency, fxRateToBase: "" };
      }
      return { ...f, currency: newCurrency };
    });
    setSaved(false);
  }

  async function save(action: "save" | "approve") {
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
      };

      if (action === "approve") {
        body.status = "approved";
      } else if (!isApproved) {
        body.status = "draft";
      }

      if (addVendor && form.newVendorName) {
        body.newVendorName = form.newVendorName;
        body.vendorId = null;
      } else {
        body.vendorId = form.vendorId ? Number(form.vendorId) : null;
      }

      const res = await fetch(`/api/invoices/${invoice.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : JSON.stringify(json.error));
      setSaved(true);
      if (action === "approve") router.push("/");
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function tryMimoExtraction() {
    setExtracting(true);
    setExtractionError("");
    setMimoExtraction(null);
    try {
      const response = await fetch(`/api/invoices/${invoice.id}/extract`, { method: "POST" });
      let json: { error?: unknown; extraction?: MimoInvoiceExtraction };
      try {
        json = await response.json();
      } catch {
        throw new Error("AI extraction returned an unreadable response.");
      }
      if (!response.ok) {
        throw new Error(typeof json.error === "string" ? json.error : "AI extraction failed.");
      }
      if (!json.extraction) throw new Error("AI extraction returned no preview data.");
      setMimoExtraction(json.extraction);
    } catch (error: unknown) {
      setExtractionError(error instanceof Error ? error.message : "AI extraction failed.");
    } finally {
      setExtracting(false);
    }
  }

  const approveDisabled = saving || mismatch || hasInputErrors;
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
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 700, color: "#1e3a5f", marginBottom: 5 }}>AI extraction preview</div>
          <div style={{ fontSize: 13, lineHeight: 1.5, color: "#475569", marginBottom: 12 }}>
            Before sending: this invoice document will be processed by <strong>Xiaomi MiMo</strong>.
            The result is a preview only and will not change saved or manually entered invoice values.
          </div>
          <button
            type="button"
            onClick={tryMimoExtraction}
            disabled={!doc || extracting}
            style={{
              padding: "9px 14px",
              border: "none",
              borderRadius: 6,
              background: !doc || extracting ? "#cbd5e1" : "#2563eb",
              color: "#fff",
              cursor: !doc || extracting ? "default" : "pointer",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {extracting ? "Extracting with MiMo…" : "Try AI extraction"}
          </button>
          {!doc && <div style={{ marginTop: 8, color: "#64748b", fontSize: 12 }}>Attach a document before trying AI extraction.</div>}
          {extractionError && (
            <div style={{ marginTop: 12, padding: "9px 12px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, color: "#b91c1c", fontSize: 13 }}>
              {extractionError}
            </div>
          )}
        </div>

        {mimoExtraction && <MimoExtractionPreview extraction={mimoExtraction} />}

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
                background: isApproved ? "#dcfce7" : "#fef9c3",
                color: isApproved ? "#166534" : "#713f12",
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
                    <option value="">-- select vendor --</option>
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
                <select style={{ ...inputStyle, flex: 1 }} value={form.currency} onChange={handleCurrencyChange}>
                  {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
                </select>
                <input
                  style={{ ...inputStyle, flex: 1 }}
                  value={form.currency}
                  onChange={handleCurrencyChange}
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
              currentIsSameCurrency ? (
                <input style={readOnlyStyle} value="1" readOnly />
              ) : (
                <input
                  style={form.fxRateToBase && safeParseDecimal(form.fxRateToBase).error ? errorInputStyle : inputStyle}
                  value={form.fxRateToBase}
                  onChange={set("fxRateToBase")}
                  placeholder="Enter rate"
                />
              ),
              currentIsSameCurrency
                ? `Same as base currency (${baseCurrency}) — rate is 1`
                : `1 ${form.currency} = ? ${baseCurrency}`
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
                <input
                  style={form.netAmount && safeParseDecimal(form.netAmount).error ? errorInputStyle : inputStyle}
                  value={form.netAmount}
                  onChange={set("netAmount")}
                  placeholder="0.00"
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, color: "#64748b", marginBottom: 4 }}>VAT Amount</label>
                <input
                  style={form.vatAmount && safeParseDecimal(form.vatAmount).error ? errorInputStyle : inputStyle}
                  value={form.vatAmount}
                  onChange={set("vatAmount")}
                  placeholder="0.00"
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, color: "#64748b", marginBottom: 4 }}>
                  Gross Amount
                  {mismatch && " !!"}
                </label>
                <input
                  style={form.grossAmount && safeParseDecimal(form.grossAmount).error
                    ? errorInputStyle
                    : mismatch ? warnStyle : inputStyle}
                  value={form.grossAmount}
                  onChange={set("grossAmount")}
                  placeholder="0.00"
                />
              </div>
            </div>
            {hasInputErrors && (
              <div
                style={{
                  marginTop: 10,
                  padding: "8px 12px",
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  borderRadius: 6,
                  fontSize: 13,
                  color: "#dc2626",
                }}
              >
                {inputErrors.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            )}
            {!hasInputErrors && mismatch && (
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

          {/* Base amounts (read-only) */}
          {showBaseAmounts && (
            <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#0369a1", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Base Amounts ({baseCurrency})
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12, color: "#64748b", marginBottom: 4 }}>Base Net</label>
                  <input style={readOnlyStyle} value={previewBaseNet ? formatDisplayAmount(previewBaseNet, "fiat") : ""} readOnly />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, color: "#64748b", marginBottom: 4 }}>Base VAT</label>
                  <input style={readOnlyStyle} value={previewBaseVat ? formatDisplayAmount(previewBaseVat, "fiat") : ""} readOnly />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, color: "#64748b", marginBottom: 4 }}>Base Gross</label>
                  <input style={readOnlyStyle} value={previewBaseGross ? formatDisplayAmount(previewBaseGross, "fiat") : ""} readOnly />
                </div>
              </div>
              {!currentIsSameCurrency && !form.fxRateToBase && (
                <div style={{ marginTop: 8, fontSize: 12, color: "#0369a1" }}>
                  Enter an FX rate to see base amounts.
                </div>
              )}
            </div>
          )}

          {/* Cost centre + account */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {field(
              "Cost Centre (optional)",
              <select style={inputStyle} value={form.costCentreId} onChange={set("costCentreId")}>
                <option value="">-- none --</option>
                {costCentres.map((c) => (
                  <option key={c.id} value={c.id}>{c.code} · {c.name}</option>
                ))}
              </select>
            )}
            {field(
              "Expense Account (optional)",
              <select style={inputStyle} value={form.expenseAccountId} onChange={set("expenseAccountId")}>
                <option value="">-- none --</option>
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
              {isApproved ? "Changes saved" : "Draft saved"}
            </div>
          )}

          <div style={{ display: "flex", gap: 12 }}>
            <button
              onClick={() => save("save")}
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
              {isApproved ? "Save Changes" : "Save Draft"}
            </button>
            {!isApproved && (
              <button
                onClick={() => save("approve")}
                disabled={approveDisabled}
                title={
                  hasInputErrors ? "Fix invalid input before approving"
                    : mismatch ? "Fix amount mismatch before approving"
                    : ""
                }
                style={{
                  padding: "10px 20px",
                  background: approveDisabled ? "#e2e8f0" : "#16a34a",
                  color: approveDisabled ? "#94a3b8" : "#fff",
                  border: "none",
                  borderRadius: 6,
                  cursor: approveDisabled ? "default" : "pointer",
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                Approve Invoice
              </button>
            )}
          </div>
          {!isApproved && (hasInputErrors || mismatch) && (
            <div style={{ marginTop: 8, fontSize: 12, color: "#d97706" }}>
              {hasInputErrors
                ? "Approve is disabled until invalid input is corrected."
                : "Approve is disabled until the amount mismatch is resolved."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
