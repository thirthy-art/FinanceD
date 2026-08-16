"use client";
import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  isAmountMismatch,
  parseAmount,
  parseSafeDecimal,
  isValidDecimalString,
  multiplyToFixed2,
  computeVatAmount,
  computeGross,
  isVatRateValid,
  decimalStringsMismatch,
} from "@/src/lib/invoice-validation";

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
  fxRate: string | null;
  netAmount: string | null;
  vatAmount: string | null;
  grossAmount: string | null;
  costCentreId: number | null;
  expenseAccountId: number | null;
  notes: string | null;
  status: "draft" | "approved";
}

interface InvoiceLine {
  id?: number;
  lineNumber: number;
  descriptionOriginal: string | null;
  description: string | null;
  quantity: string | null;
  unit: string | null;
  unitPrice: string | null;
  netAmount: string | null;
  vatRate: string | null;
  vatAmount: string | null;
  grossAmount: string | null;
  sourcePage: number | null;
  treatment: "immediate" | "prepaid";
  accountingAccountNumber: string | null;
  prepaidAccountNumber: string | null;
  recognitionStart: string | null;
  recognitionEnd: string | null;
}

interface LineDraft {
  id?: number;
  lineNumber: number;
  description: string;
  descriptionOriginal: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  netAmount: string;
  netDerived: boolean;
  vatRate: string;
  vatAmount: string;
  vatDerived: boolean;
  grossAmount: string;
  grossDerived: boolean;
  sourcePage: string;
  treatment: "immediate" | "prepaid";
  accountingAccountNumber: string;
  prepaidAccountNumber: string;
  recognitionStart: string;
  recognitionEnd: string;
}

interface Props {
  invoice: Invoice;
  documents: Document[];
  vendors: Vendor[];
  costCentres: CostCentre[];
  accounts: Account[];
  extractedFields: Record<string, string>;
  initialLines: InvoiceLine[];
}

const CURRENCIES = ["USD", "EUR", "GBP", "CHF", "CAD", "AUD", "JPY", "SEK", "NOK", "DKK", "RON"];

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
  boxSizing: "border-box",
};

const errorStyle: React.CSSProperties = {
  ...inputStyle,
  borderColor: "#ef4444",
  background: "#fef2f2",
};

const warnStyle: React.CSSProperties = {
  ...inputStyle,
  borderColor: "#f59e0b",
  background: "#fffbeb",
};

function numericInputStyle(value: string, required = false): React.CSSProperties {
  if (!value.trim()) return required ? errorStyle : inputStyle;
  if (!isValidDecimalString(value)) return errorStyle;
  return inputStyle;
}

function lineToDraft(line: InvoiceLine, index: number): LineDraft {
  return {
    id: line.id,
    lineNumber: line.lineNumber ?? index + 1,
    description: line.description ?? "",
    descriptionOriginal: line.descriptionOriginal ?? "",
    quantity: line.quantity ?? "",
    unit: line.unit ?? "",
    unitPrice: line.unitPrice ?? "",
    netAmount: line.netAmount ?? "",
    netDerived: false,
    vatRate: line.vatRate ?? "",
    vatAmount: line.vatAmount ?? "",
    vatDerived: false,
    grossAmount: line.grossAmount ?? "",
    grossDerived: false,
    sourcePage: line.sourcePage != null ? String(line.sourcePage) : "",
    treatment: line.treatment ?? "immediate",
    accountingAccountNumber: line.accountingAccountNumber ?? "",
    prepaidAccountNumber: line.prepaidAccountNumber ?? "",
    recognitionStart: line.recognitionStart ?? "",
    recognitionEnd: line.recognitionEnd ?? "",
  };
}

function applyAutoCalc(draft: LineDraft): LineDraft {
  const result = { ...draft };

  const qty = parseSafeDecimal(draft.quantity);
  const price = parseSafeDecimal(draft.unitPrice);

  if (qty !== null && price !== null) {
    const calcNet = multiplyToFixed2(draft.quantity, draft.unitPrice);
    if (calcNet !== null) {
      if (result.netDerived || !result.netAmount.trim()) {
        result.netAmount = calcNet;
        result.netDerived = true;
      }
    }
  }

  const net = parseSafeDecimal(result.netAmount);
  const vatRate = parseSafeDecimal(draft.vatRate);

  if (net !== null && vatRate !== null) {
    const calcVat = computeVatAmount(result.netAmount, draft.vatRate);
    if (calcVat !== null) {
      if (result.vatDerived || !result.vatAmount.trim()) {
        result.vatAmount = calcVat;
        result.vatDerived = true;
      }
    }
  }

  const vat = parseSafeDecimal(result.vatAmount);

  if (net !== null && vat !== null) {
    const calcGross = computeGross(result.netAmount, result.vatAmount);
    if (calcGross !== null) {
      if (result.grossDerived || !result.grossAmount.trim()) {
        result.grossAmount = calcGross;
        result.grossDerived = true;
      }
    }
  }

  return result;
}

function recognitionMonths(start: string, end: string): { month: string; amount: number }[] | null {
  const startD = parseSafeDecimal(start.replace(/-/g, "")) !== null ? new Date(start) : null;
  const endD = parseSafeDecimal(end.replace(/-/g, "")) !== null ? new Date(end) : null;
  if (!startD || isNaN(startD.getTime()) || !endD || isNaN(endD.getTime())) return null;
  if (endD < startD) return null;

  const months: string[] = [];
  const cur = new Date(startD.getFullYear(), startD.getMonth(), 1);
  const endYM = endD.getFullYear() * 12 + endD.getMonth();
  while (cur.getFullYear() * 12 + cur.getMonth() <= endYM) {
    months.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}`);
    cur.setMonth(cur.getMonth() + 1);
  }
  return months.map((m) => ({ month: m, amount: 0 }));
}

export default function InvoiceReview({
  invoice,
  documents,
  vendors,
  costCentres,
  accounts,
  extractedFields,
  initialLines,
}: Props) {
  const router = useRouter();
  const [form, setForm] = useState({
    vendorId: invoice.vendorId ? String(invoice.vendorId) : "",
    newVendorName: "",
    invoiceNumber: invoice.invoiceNumber ?? extractedFields.invoiceNumber ?? "",
    invoiceDate: invoice.invoiceDate ?? extractedFields.invoiceDate ?? "",
    dueDate: invoice.dueDate ?? extractedFields.dueDate ?? "",
    currency: invoice.currency ?? extractedFields.currency ?? "USD",
    fxRate: invoice.fxRate ?? "1",
    netAmount: invoice.netAmount ?? extractedFields.netAmount ?? "",
    vatAmount: invoice.vatAmount ?? extractedFields.vatAmount ?? "",
    grossAmount: invoice.grossAmount ?? extractedFields.grossAmount ?? "",
    costCentreId: invoice.costCentreId ? String(invoice.costCentreId) : "",
    notes: invoice.notes ?? "",
  });

  const [lines, setLines] = useState<LineDraft[]>(
    initialLines.length > 0
      ? initialLines.map(lineToDraft)
      : []
  );

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(false);
  const [addVendor, setAddVendor] = useState(false);

  const doc = documents[0];

  // Invoice-level amount validation (applies when no lines)
  const net = parseAmount(form.netAmount);
  const vat = parseAmount(form.vatAmount);
  const gross = parseAmount(form.grossAmount);
  const computed = net + vat;
  const invoiceMismatch = lines.length === 0 && isAmountMismatch(net, vat, gross);

  // Account lists
  const expenseAccounts = accounts.filter((a) => a.type === "expense" && a.isActive);
  const assetAccounts = accounts.filter((a) => a.type === "asset" && a.isActive);

  function setFormField(k: string) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      setForm((f) => ({ ...f, [k]: e.target.value }));
      setSaved(false);
    };
  }

  const updateLine = useCallback((idx: number, field: keyof LineDraft, value: string | boolean) => {
    setLines((prev) =>
      prev.map((line, i) => {
        if (i !== idx) return line;
        const updated = { ...line, [field]: value };
        if (field === "netAmount") updated.netDerived = false;
        if (field === "vatAmount") updated.vatDerived = false;
        if (field === "grossAmount") updated.grossDerived = false;
        return applyAutoCalc(updated);
      })
    );
    setSaved(false);
  }, []);

  function addLine() {
    const nextNum = lines.length > 0 ? Math.max(...lines.map((l) => l.lineNumber)) + 1 : 1;
    setLines((prev) => [
      ...prev,
      applyAutoCalc({
        id: undefined,
        lineNumber: nextNum,
        description: "",
        descriptionOriginal: "",
        quantity: "",
        unit: "",
        unitPrice: "",
        netAmount: "",
        netDerived: false,
        vatRate: "",
        vatAmount: "",
        vatDerived: false,
        grossAmount: "",
        grossDerived: false,
        sourcePage: "",
        treatment: "immediate",
        accountingAccountNumber: "",
        prepaidAccountNumber: "",
        recognitionStart: "",
        recognitionEnd: "",
      }),
    ]);
    setSaved(false);
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx).map((l, i) => ({ ...l, lineNumber: i + 1 })));
    setSaved(false);
  }

  async function save(status: "draft" | "approved") {
    setSaving(true);
    setSaveError("");
    try {
      // Save invoice header
      const body: Record<string, unknown> = {
        invoiceNumber: form.invoiceNumber || null,
        invoiceDate: form.invoiceDate || null,
        dueDate: form.dueDate || null,
        currency: form.currency,
        fxRate: form.fxRate || "1",
        costCentreId: form.costCentreId ? Number(form.costCentreId) : null,
        notes: form.notes || null,
        status,
      };

      // Only send invoice-level amounts when no lines are present
      if (lines.length === 0) {
        body.netAmount = form.netAmount || null;
        body.vatAmount = form.vatAmount || null;
        body.grossAmount = form.grossAmount || null;
      }

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
      if (!res.ok) throw new Error(Array.isArray(json.error) ? json.error.join("\n") : JSON.stringify(json.error));

      // Save lines
      if (lines.length > 0) {
        const linesPayload = lines.map((l) => ({
          lineNumber: l.lineNumber,
          description: l.description || null,
          descriptionOriginal: l.descriptionOriginal || null,
          quantity: l.quantity || null,
          unit: l.unit || null,
          unitPrice: l.unitPrice || null,
          netAmount: l.netAmount || null,
          vatRate: l.vatRate || null,
          vatAmount: l.vatAmount || null,
          grossAmount: l.grossAmount || null,
          sourcePage: l.sourcePage ? Number(l.sourcePage) : null,
          treatment: l.treatment,
          accountingAccountNumber: l.accountingAccountNumber || null,
          prepaidAccountNumber: l.prepaidAccountNumber || null,
          recognitionStart: l.recognitionStart || null,
          recognitionEnd: l.recognitionEnd || null,
        }));

        const lRes = await fetch(`/api/invoices/${invoice.id}/lines`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lines: linesPayload }),
        });
        const lJson = await lRes.json();
        if (!lRes.ok) {
          throw new Error(
            Array.isArray(lJson.error) ? lJson.error.join("\n") : JSON.stringify(lJson.error)
          );
        }
      }

      setSaved(true);
      if (status === "approved") router.push("/");
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  // Check if approval should be blocked
  const lineApprovalErrors: string[] = [];
  for (const line of lines) {
    const label = `Line ${line.lineNumber}`;
    for (const [fname, val] of [
      ["quantity", line.quantity],
      ["unitPrice", line.unitPrice],
      ["netAmount", line.netAmount],
      ["vatAmount", line.vatAmount],
      ["grossAmount", line.grossAmount],
    ] as const) {
      if (val && !isValidDecimalString(val)) {
        lineApprovalErrors.push(`${label}: ${fname} is not a valid number`);
      }
    }
    if (line.vatRate && !isVatRateValid(line.vatRate)) {
      lineApprovalErrors.push(`${label}: VAT rate (%) must be 0–100`);
    }
    if (line.treatment === "prepaid") {
      if (!line.accountingAccountNumber) lineApprovalErrors.push(`${label}: Expense account required`);
      if (!line.prepaidAccountNumber) lineApprovalErrors.push(`${label}: Prepaid account required`);
      if (!line.recognitionStart) lineApprovalErrors.push(`${label}: Recognition start required`);
      if (!line.recognitionEnd) lineApprovalErrors.push(`${label}: Recognition end required`);
      if (line.recognitionStart && line.recognitionEnd && line.recognitionStart > line.recognitionEnd) {
        lineApprovalErrors.push(`${label}: End date must be ≥ start date`);
      }
    }
  }

  const approveBlocked = invoiceMismatch || lineApprovalErrors.length > 0;

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
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "#1e3a5f" }}>Invoice Details</h2>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
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
              <a
                href={`/api/invoices/${invoice.id}/export`}
                style={{ fontSize: 12, color: "#2563eb", textDecoration: "none", padding: "3px 10px", border: "1px solid #e2e8f0", borderRadius: 6 }}
              >
                Export XLSX
              </a>
            </div>
          </div>

          {/* Vendor */}
          {field(
            "Vendor",
            <>
              {!addVendor ? (
                <div style={{ display: "flex", gap: 8 }}>
                  <select style={{ ...inputStyle, flex: 1 }} value={form.vendorId} onChange={setFormField("vendorId")}>
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
                    onChange={setFormField("newVendorName")}
                  />
                  <button
                    onClick={() => setAddVendor(false)}
                    style={{ padding: "8px 12px", border: "1px solid #e2e8f0", borderRadius: 6, background: "#f8fafc", cursor: "pointer", fontSize: 13 }}
                    type="button"
                  >
                    x
                  </button>
                </div>
              )}
            </>
          )}

          {/* Invoice number + date */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {field("Invoice Number", <input style={inputStyle} value={form.invoiceNumber} onChange={setFormField("invoiceNumber")} placeholder="INV-001" />)}
            {field("Invoice Date", <input style={inputStyle} type="date" value={form.invoiceDate} onChange={setFormField("invoiceDate")} />)}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {field("Due Date", <input style={inputStyle} type="date" value={form.dueDate} onChange={setFormField("dueDate")} />)}
            {field(
              "Currency",
              <select style={inputStyle} value={form.currency} onChange={setFormField("currency")}>
                {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            )}
          </div>

          {/* Invoice-level amounts — only shown when no lines */}
          {lines.length === 0 && (
            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Amounts
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12, color: "#64748b", marginBottom: 4 }}>Net Amount</label>
                  <input style={inputStyle} value={form.netAmount} onChange={setFormField("netAmount")} placeholder="0.00" inputMode="decimal" />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, color: "#64748b", marginBottom: 4 }}>VAT Amount</label>
                  <input style={inputStyle} value={form.vatAmount} onChange={setFormField("vatAmount")} placeholder="0.00" inputMode="decimal" />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, color: "#64748b", marginBottom: 4 }}>
                    Gross Amount
                    {invoiceMismatch && " ⚠"}
                  </label>
                  <input style={invoiceMismatch ? warnStyle : inputStyle} value={form.grossAmount} onChange={setFormField("grossAmount")} placeholder="0.00" inputMode="decimal" />
                </div>
              </div>
              {invoiceMismatch && (
                <div style={{ marginTop: 10, padding: "8px 12px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, fontSize: 13, color: "#92400e" }}>
                  Net + VAT = {computed.toFixed(2)} but Gross = {gross.toFixed(2)} (difference: {Math.abs(computed - gross).toFixed(2)}). Please verify.
                </div>
              )}
            </div>
          )}

          {/* Cost centre */}
          {field(
            "Cost Centre (optional)",
            <select style={inputStyle} value={form.costCentreId} onChange={setFormField("costCentreId")}>
              <option value="">— none —</option>
              {costCentres.map((c) => (
                <option key={c.id} value={c.id}>{c.code} · {c.name}</option>
              ))}
            </select>
          )}

          {field(
            "Notes",
            <textarea
              style={{ ...inputStyle, minHeight: 64, resize: "vertical" }}
              value={form.notes}
              onChange={setFormField("notes")}
              placeholder="Any additional notes…"
            />
          )}
        </div>

        {/* ── Invoice Lines ─────────────────────────────────────────────────── */}
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 24, marginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: "#1e3a5f" }}>Invoice Lines</h3>
            <button
              onClick={addLine}
              type="button"
              style={{ padding: "6px 14px", border: "1px solid #2563eb", borderRadius: 6, background: "#eff6ff", color: "#2563eb", cursor: "pointer", fontSize: 13, fontWeight: 500 }}
            >
              + Add Line
            </button>
          </div>

          {lines.length === 0 && (
            <div style={{ color: "#94a3b8", fontSize: 13, padding: "16px 0" }}>
              No lines yet. Add a line to capture line-level detail.
            </div>
          )}

          {lines.map((line, idx) => (
            <LineEditor
              key={idx}
              line={line}
              idx={idx}
              expenseAccounts={expenseAccounts}
              assetAccounts={assetAccounts}
              onUpdate={updateLine}
              onRemove={() => removeLine(idx)}
            />
          ))}
        </div>

        {/* ── Errors & Actions ─────────────────────────────────────────────── */}
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 24, marginTop: 16 }}>
          {lineApprovalErrors.length > 0 && (
            <div style={{ marginBottom: 16, padding: "10px 14px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, color: "#dc2626", fontSize: 13 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Approval blocked:</div>
              {lineApprovalErrors.map((e, i) => <div key={i}>{e}</div>)}
            </div>
          )}

          {saveError && (
            <div style={{ marginBottom: 16, padding: "10px 14px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, color: "#dc2626", fontSize: 13, whiteSpace: "pre-wrap" }}>
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
              style={{ padding: "10px 20px", border: "1px solid #e2e8f0", borderRadius: 6, background: "#f8fafc", cursor: saving ? "default" : "pointer", fontSize: 14, fontWeight: 500 }}
            >
              Save Draft
            </button>
            <button
              onClick={() => save("approved")}
              disabled={saving || approveBlocked}
              title={approveBlocked ? "Fix validation errors before approving" : ""}
              style={{
                padding: "10px 20px",
                background: approveBlocked ? "#e2e8f0" : "#16a34a",
                color: approveBlocked ? "#94a3b8" : "#fff",
                border: "none",
                borderRadius: 6,
                cursor: saving || approveBlocked ? "default" : "pointer",
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              Approve Invoice
            </button>
          </div>
          {invoiceMismatch && lines.length === 0 && (
            <div style={{ marginTop: 8, fontSize: 12, color: "#d97706" }}>
              Approve is disabled until the amount mismatch is resolved.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Line Editor ───────────────────────────────────────────────────────────────

interface LineEditorProps {
  line: LineDraft;
  idx: number;
  expenseAccounts: Account[];
  assetAccounts: Account[];
  onUpdate: (idx: number, field: keyof LineDraft, value: string | boolean) => void;
  onRemove: () => void;
}

function LineEditor({ line, idx, expenseAccounts, assetAccounts, onUpdate, onRemove }: LineEditorProps) {
  function set(f: keyof LineDraft) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      onUpdate(idx, f, e.target.value);
    };
  }

  // Mismatch checks for warnings
  const calcNet = multiplyToFixed2(line.quantity, line.unitPrice);
  const netMismatch =
    calcNet !== null &&
    line.netAmount.trim() &&
    !line.netDerived &&
    decimalStringsMismatch(calcNet, line.netAmount);

  const calcVat = computeVatAmount(line.netAmount, line.vatRate);
  const vatMismatch =
    calcVat !== null &&
    line.vatAmount.trim() &&
    !line.vatDerived &&
    decimalStringsMismatch(calcVat, line.vatAmount);

  const calcGross = computeGross(line.netAmount, line.vatAmount);
  const grossMismatch =
    calcGross !== null &&
    line.grossAmount.trim() &&
    !line.grossDerived &&
    decimalStringsMismatch(calcGross, line.grossAmount);

  const vatRateError = line.vatRate.trim() && !isVatRateValid(line.vatRate);

  // Recognition preview (crash-safe)
  const showRecognition = line.treatment === "prepaid";
  let recognitionSchedule: { month: string; amount: number }[] | null = null;
  if (showRecognition && line.netAmount.trim() && line.recognitionStart && line.recognitionEnd) {
    const netV = parseSafeDecimal(line.netAmount);
    if (netV !== null && netV > 0) {
      const schedule = recognitionMonths(line.recognitionStart, line.recognitionEnd);
      if (schedule && schedule.length > 0) {
        const perMonth = Math.round((netV / schedule.length) * 100) / 100;
        // Adjust last month for rounding difference
        const total = perMonth * schedule.length;
        const diff = Math.round((netV - total) * 100) / 100;
        recognitionSchedule = schedule.map((s, i) => ({
          ...s,
          amount: i === schedule.length - 1 ? perMonth + diff : perMonth,
        }));
      }
    }
  }

  const numInput = (f: keyof LineDraft, placeholder = "0.00") => (
    <input
      style={numericInputStyle(line[f] as string)}
      value={line[f] as string}
      onChange={set(f)}
      placeholder={placeholder}
      inputMode="decimal"
    />
  );

  return (
    <div
      style={{
        border: "1px solid #e2e8f0",
        borderRadius: 8,
        padding: 16,
        marginBottom: 12,
        background: "#f8fafc",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontWeight: 600, fontSize: 13, color: "#475569" }}>Line {line.lineNumber}</span>
        <button
          type="button"
          onClick={onRemove}
          style={{ padding: "2px 8px", border: "1px solid #fecaca", borderRadius: 4, background: "#fff", color: "#dc2626", cursor: "pointer", fontSize: 12 }}
        >
          Remove
        </button>
      </div>

      {/* Description */}
      <div style={{ marginBottom: 10 }}>
        <label style={{ display: "block", fontSize: 11, color: "#64748b", marginBottom: 3, fontWeight: 600, textTransform: "uppercase" }}>Description</label>
        <input
          style={inputStyle}
          value={line.description}
          onChange={set("description")}
          placeholder={line.descriptionOriginal || "Line description"}
        />
      </div>

      {/* Qty / UoM / Unit Price */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: 10, marginBottom: 10 }}>
        <div>
          <label style={{ display: "block", fontSize: 11, color: "#64748b", marginBottom: 3, fontWeight: 600, textTransform: "uppercase" }}>Quantity</label>
          {numInput("quantity")}
          {line.quantity.trim() && !isValidDecimalString(line.quantity) && (
            <div style={{ fontSize: 11, color: "#dc2626", marginTop: 2 }}>Invalid number</div>
          )}
        </div>
        <div>
          <label style={{ display: "block", fontSize: 11, color: "#64748b", marginBottom: 3, fontWeight: 600, textTransform: "uppercase" }}>Unit of Measure</label>
          <input
            style={inputStyle}
            value={line.unit}
            onChange={set("unit")}
            placeholder="pcs / kg / hours"
          />
        </div>
        <div>
          <label style={{ display: "block", fontSize: 11, color: "#64748b", marginBottom: 3, fontWeight: 600, textTransform: "uppercase" }}>Unit Price</label>
          {numInput("unitPrice")}
          {line.unitPrice.trim() && !isValidDecimalString(line.unitPrice) && (
            <div style={{ fontSize: 11, color: "#dc2626", marginTop: 2 }}>Invalid number</div>
          )}
        </div>
      </div>

      {/* Net / VAT Rate / VAT / Gross */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 10, marginBottom: 10 }}>
        <div>
          <label style={{ display: "block", fontSize: 11, color: "#64748b", marginBottom: 3, fontWeight: 600, textTransform: "uppercase" }}>
            Net Amount {line.netDerived && <span style={{ color: "#94a3b8", fontWeight: 400, textTransform: "none" }}>(auto)</span>}
          </label>
          <input
            style={
              line.netAmount.trim() && !isValidDecimalString(line.netAmount)
                ? errorStyle
                : netMismatch
                ? warnStyle
                : inputStyle
            }
            value={line.netAmount}
            onChange={set("netAmount")}
            placeholder="0.00"
            inputMode="decimal"
          />
          {line.netAmount.trim() && !isValidDecimalString(line.netAmount) && (
            <div style={{ fontSize: 11, color: "#dc2626", marginTop: 2 }}>Invalid number</div>
          )}
          {netMismatch && (
            <div style={{ fontSize: 11, color: "#92400e", marginTop: 2 }}>
              Qty x Price = {calcNet} — mismatch with entered Net
            </div>
          )}
        </div>

        <div>
          <label style={{ display: "block", fontSize: 11, color: "#64748b", marginBottom: 3, fontWeight: 600, textTransform: "uppercase" }}>VAT Rate (%)</label>
          <input
            style={vatRateError ? errorStyle : inputStyle}
            value={line.vatRate}
            onChange={set("vatRate")}
            placeholder="19"
            inputMode="decimal"
          />
          {vatRateError && (
            <div style={{ fontSize: 11, color: "#dc2626", marginTop: 2 }}>
              {parseSafeDecimal(line.vatRate) === null ? "Invalid number" : "Must be 0–100"}
            </div>
          )}
        </div>

        <div>
          <label style={{ display: "block", fontSize: 11, color: "#64748b", marginBottom: 3, fontWeight: 600, textTransform: "uppercase" }}>
            VAT Amount {line.vatDerived && <span style={{ color: "#94a3b8", fontWeight: 400, textTransform: "none" }}>(auto)</span>}
          </label>
          <input
            style={
              line.vatAmount.trim() && !isValidDecimalString(line.vatAmount)
                ? errorStyle
                : vatMismatch
                ? warnStyle
                : inputStyle
            }
            value={line.vatAmount}
            onChange={set("vatAmount")}
            placeholder="0.00"
            inputMode="decimal"
          />
          {line.vatAmount.trim() && !isValidDecimalString(line.vatAmount) && (
            <div style={{ fontSize: 11, color: "#dc2626", marginTop: 2 }}>Invalid number</div>
          )}
          {vatMismatch && (
            <div style={{ fontSize: 11, color: "#92400e", marginTop: 2 }}>
              Net x {line.vatRate}% = {calcVat} — mismatch with entered VAT
            </div>
          )}
        </div>

        <div>
          <label style={{ display: "block", fontSize: 11, color: "#64748b", marginBottom: 3, fontWeight: 600, textTransform: "uppercase" }}>
            Gross Amount {line.grossDerived && <span style={{ color: "#94a3b8", fontWeight: 400, textTransform: "none" }}>(auto)</span>}
          </label>
          <input
            style={
              line.grossAmount.trim() && !isValidDecimalString(line.grossAmount)
                ? errorStyle
                : grossMismatch
                ? warnStyle
                : inputStyle
            }
            value={line.grossAmount}
            onChange={set("grossAmount")}
            placeholder="0.00"
            inputMode="decimal"
          />
          {line.grossAmount.trim() && !isValidDecimalString(line.grossAmount) && (
            <div style={{ fontSize: 11, color: "#dc2626", marginTop: 2 }}>Invalid number</div>
          )}
          {grossMismatch && (
            <div style={{ fontSize: 11, color: "#92400e", marginTop: 2 }}>
              Net + VAT = {calcGross} — mismatch with entered Gross
            </div>
          )}
        </div>
      </div>

      {/* Treatment + Account */}
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 10, alignItems: "center", marginBottom: 10 }}>
        <div>
          <label style={{ display: "block", fontSize: 11, color: "#64748b", marginBottom: 3, fontWeight: 600, textTransform: "uppercase" }}>Treatment</label>
          <select
            style={{ ...inputStyle, width: "auto" }}
            value={line.treatment}
            onChange={(e) => onUpdate(idx, "treatment", e.target.value as "immediate" | "prepaid")}
          >
            <option value="immediate">Immediate</option>
            <option value="prepaid">Prepaid</option>
          </select>
        </div>

        <div>
          <label style={{ display: "block", fontSize: 11, color: "#64748b", marginBottom: 3, fontWeight: 600, textTransform: "uppercase" }}>
            Expense Account {line.treatment === "prepaid" && <span style={{ color: "#dc2626" }}>*</span>}
          </label>
          <select
            style={line.treatment === "prepaid" && !line.accountingAccountNumber ? warnStyle : inputStyle}
            value={line.accountingAccountNumber}
            onChange={set("accountingAccountNumber")}
          >
            <option value="">— select expense account —</option>
            {expenseAccounts.map((a) => (
              <option key={a.id} value={a.code}>{a.code} — {a.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Prepaid-specific fields */}
      {line.treatment === "prepaid" && (
        <div
          style={{
            background: "#eff6ff",
            border: "1px solid #bfdbfe",
            borderRadius: 6,
            padding: 12,
            marginBottom: 10,
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 600, color: "#1d4ed8", marginBottom: 8, textTransform: "uppercase" }}>
            Prepaid Details
          </div>

          <div style={{ marginBottom: 8 }}>
            <label style={{ display: "block", fontSize: 11, color: "#64748b", marginBottom: 3, fontWeight: 600, textTransform: "uppercase" }}>
              Prepaid Asset Account <span style={{ color: "#dc2626" }}>*</span>
            </label>
            <select
              style={!line.prepaidAccountNumber ? warnStyle : inputStyle}
              value={line.prepaidAccountNumber}
              onChange={set("prepaidAccountNumber")}
            >
              <option value="">— select prepaid asset account —</option>
              {assetAccounts.map((a) => (
                <option key={a.id} value={a.code}>{a.code} — {a.name}</option>
              ))}
            </select>
          </div>

          {/* Recognition dates — stacked on narrow screens */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 140px", minWidth: 0 }}>
              <label style={{ display: "block", fontSize: 11, color: "#64748b", marginBottom: 3, fontWeight: 600, textTransform: "uppercase" }}>
                Recognition Start <span style={{ color: "#dc2626" }}>*</span>
              </label>
              <input
                style={{ ...inputStyle, minWidth: 0 }}
                type="date"
                value={line.recognitionStart}
                onChange={set("recognitionStart")}
              />
            </div>
            <div style={{ flex: "1 1 140px", minWidth: 0 }}>
              <label style={{ display: "block", fontSize: 11, color: "#64748b", marginBottom: 3, fontWeight: 600, textTransform: "uppercase" }}>
                Recognition End <span style={{ color: "#dc2626" }}>*</span>
              </label>
              <input
                style={{ ...inputStyle, minWidth: 0 }}
                type="date"
                value={line.recognitionEnd}
                onChange={set("recognitionEnd")}
              />
            </div>
          </div>
          {line.recognitionStart && line.recognitionEnd && line.recognitionStart > line.recognitionEnd && (
            <div style={{ fontSize: 11, color: "#dc2626", marginTop: 4 }}>End date must be on or after start date</div>
          )}

          {/* Recognition preview */}
          {recognitionSchedule && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, color: "#1d4ed8", fontWeight: 600, marginBottom: 4 }}>
                Recognition schedule ({recognitionSchedule.length} months)
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {recognitionSchedule.map((s) => (
                  <span
                    key={s.month}
                    style={{ fontSize: 11, background: "#dbeafe", color: "#1d4ed8", padding: "2px 6px", borderRadius: 4 }}
                  >
                    {s.month}: {s.amount.toFixed(2)}
                  </span>
                ))}
              </div>
            </div>
          )}
          {showRecognition && !recognitionSchedule && line.recognitionStart && line.recognitionEnd && (
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>
              {parseSafeDecimal(line.netAmount) === null
                ? "Enter a valid net amount to see the recognition schedule."
                : "Enter valid start and end dates to see the schedule."}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
