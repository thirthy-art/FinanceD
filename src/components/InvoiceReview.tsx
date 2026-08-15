"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { safeIsAmountMismatch, safeCalculateBaseAmount, safeParseDecimal, formatDisplayAmount, toDecimal } from "@/src/lib/invoice-validation";
import type { AiInvoiceExtraction } from "@/src/lib/ai-extraction";
import type { EditableInvoiceLine } from "@/src/lib/invoice-lines";
import { editableLineToInput } from "@/src/lib/invoice-lines";
import { applyExtractionLines, applyExtractionToDraft, extractionLinesToEditable } from "@/src/lib/apply-ai-extraction";
import InvoiceLinesEditor from "@/src/components/InvoiceLinesEditor";
import { selectableExpenseAccounts } from "@/src/lib/coa-hierarchy";

interface Vendor { id: number; name: string; taxId: string | null; normalizedTaxId?: string | null; invoiceCount?: number; }
interface CostCentre { id: number; code: string; name: string; }
interface Account { id: number; code: string; name: string; type: string; parentId: number | null; isPosting: boolean; isActive: boolean; }
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
  lines: EditableInvoiceLine[];
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

function AiExtractionPreview({ extraction }: { extraction: AiInvoiceExtraction }) {
  const headerFields: Array<[string, string | null]> = [
    ["Vendor (original)", extraction.vendorOriginal],
    ["Vendor (English)", extraction.vendorNormalized],
    ["Vendor Tax ID", extraction.vendorTaxId],
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
        <div style={{ fontWeight: 700, color: "#1e3a5f" }}>AI extraction preview</div>
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
          <div style={{ color: "#64748b", fontSize: 13 }}>AI extraction did not find any invoice lines.</div>
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

export default function InvoiceReview({ invoice, documents, lines, vendors, costCentres, accounts, extractedFields, baseCurrency }: Props) {
  const router = useRouter();
  const isApproved = invoice.status === "approved";
  const isSameCurrency = invoice.currency === baseCurrency;

  const [form, setForm] = useState({
    vendorId: invoice.vendorId ? String(invoice.vendorId) : "",
    newVendorName: "",
    newVendorTaxId: "",
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
  const [vendorOptions, setVendorOptions] = useState(vendors);
  const [vendorCandidates, setVendorCandidates] = useState<Vendor[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [extractionError, setExtractionError] = useState("");
  const [aiExtraction, setAiExtraction] = useState<AiInvoiceExtraction | null>(null);
  const [editableLines, setEditableLines] = useState<EditableInvoiceLine[]>(lines);
  const [lastAppliedLineSignature, setLastAppliedLineSignature] = useState<string | null>(null);
  const [applyNotice, setApplyNotice] = useState<{ applied: string[]; skipped: string[]; warnings: string[] } | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

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
        lines: editableLines.map(editableLineToInput),
      };

      if (action === "approve") {
        body.status = "approved";
      } else if (!isApproved) {
        body.status = "draft";
      }

      if (addVendor && form.newVendorName) {
        body.newVendorName = form.newVendorName;
        body.newVendorTaxId = form.newVendorTaxId || null;
        body.vendorId = null;
      } else {
        body.vendorId = form.vendorId ? Number(form.vendorId) : null;
      }

      const res = await fetch(`/api/invoices/${invoice.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json() as { error?: unknown; vendorId?: number | null; resolvedVendor?: Vendor | null };
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : JSON.stringify(json.error));
      if (json.vendorId) {
        setForm((current) => ({ ...current, vendorId: String(json.vendorId), newVendorName: "", newVendorTaxId: "" }));
        setAddVendor(false);
        setVendorCandidates([]);
        if (json.resolvedVendor) {
          setVendorOptions((current) => current.some((vendor) => vendor.id === json.resolvedVendor!.id)
            ? current.map((vendor) => vendor.id === json.resolvedVendor!.id ? json.resolvedVendor! : vendor)
            : [...current, json.resolvedVendor!].sort((left, right) => left.name.localeCompare(right.name)));
        }
      }
      setSaved(true);
      router.refresh();
      if (action === "approve") router.push("/");
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function tryAiExtraction() {
    setExtracting(true);
    setExtractionError("");
    setAiExtraction(null);
    setApplyNotice(null);
    setVendorCandidates([]);
    try {
      const response = await fetch(`/api/invoices/${invoice.id}/extract`, { method: "POST" });
      let json: { error?: unknown; extraction?: AiInvoiceExtraction };
      try {
        json = await response.json();
      } catch {
        throw new Error("AI extraction returned an unreadable response.");
      }
      if (!response.ok) {
        throw new Error(typeof json.error === "string" ? json.error : "AI extraction failed.");
      }
      if (!json.extraction) throw new Error("AI extraction returned no preview data.");
      setAiExtraction(json.extraction);
    } catch (error: unknown) {
      setExtractionError(error instanceof Error ? error.message : "AI extraction failed.");
    } finally {
      setExtracting(false);
    }
  }

  function applyAiExtraction() {
    if (!aiExtraction) return;
    const draftResult = applyExtractionToDraft(form, aiExtraction, vendorOptions);
    const lineResult = applyExtractionLines(
      editableLines,
      extractionLinesToEditable(aiExtraction),
      lastAppliedLineSignature,
    );

    const applied = [...draftResult.appliedFields];
    const skipped = draftResult.skippedFields.filter((field) => !field.includes("(unrecognized date)"));
    const warnings = draftResult.skippedFields.filter((field) => field.includes("(unrecognized date)"));
    if (aiExtraction.lines.length > 0) {
      if (lineResult.applied) applied.push("Invoice lines");
      else skipped.push("Invoice lines");
    }

    setForm((current) => {
      const next = { ...current, ...draftResult.draft };
      if (draftResult.vendorResolution.kind === "new") {
        next.vendorId = "";
        next.newVendorName = draftResult.vendorResolution.name;
        next.newVendorTaxId = draftResult.vendorResolution.taxId;
      } else if (draftResult.vendorResolution.kind === "selected") {
        next.newVendorName = "";
        next.newVendorTaxId = "";
      }
      if (draftResult.appliedFields.includes("Currency")) {
        next.fxRateToBase = next.currency === baseCurrency ? "1" : "";
      }
      return next;
    });
    setEditableLines(lineResult.lines);
    setLastAppliedLineSignature(lineResult.signature);
    setAddVendor(draftResult.vendorResolution.kind === "new");
    setVendorCandidates(draftResult.vendorResolution.kind === "ambiguous" ? draftResult.vendorResolution.candidates : []);
    setApplyNotice({ applied, skipped, warnings });
    setSaved(false);
  }

  async function deleteInvoice() {
    if (deleting || isApproved) return;
    setDeleting(true);
    setDeleteError("");
    try {
      const response = await fetch(`/api/invoices/${invoice.id}`, { method: "DELETE" });
      const json = await response.json().catch(() => ({})) as { error?: unknown };
      if (!response.ok) throw new Error(typeof json.error === "string" ? json.error : "Invoice deletion failed.");
      router.push("/?deleted=1");
      router.refresh();
    } catch (error: unknown) {
      setDeleteError(error instanceof Error ? error.message : "Invoice deletion failed.");
      setDeleting(false);
    }
  }

  const approveDisabled = saving || mismatch || hasInputErrors;
  const expenseAccounts = selectableExpenseAccounts(accounts);

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
            Before sending: this invoice document will be processed by the configured AI extraction service.
            The result is a preview only and will not change saved or manually entered invoice values.
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={tryAiExtraction}
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
              {extracting ? "Running AI extraction…" : "Try AI extraction"}
            </button>
            {aiExtraction && (
              <button
                type="button"
                onClick={applyAiExtraction}
                style={{ padding: "9px 14px", border: "none", borderRadius: 6, background: "#16a34a", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700 }}
              >
                Apply AI extraction
              </button>
            )}
          </div>
          {aiExtraction && !applyNotice && (
            <div style={{ marginTop: 10, color: "#475569", fontSize: 13 }}>
              Review the extracted values, then apply them to the draft.
            </div>
          )}
          {!doc && <div style={{ marginTop: 8, color: "#64748b", fontSize: 12 }}>Attach a document before trying AI extraction.</div>}
          {extractionError && (
            <div style={{ marginTop: 12, padding: "9px 12px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, color: "#b91c1c", fontSize: 13 }}>
              {extractionError}
            </div>
          )}
          {applyNotice && (
            <div style={{ marginTop: 12, padding: "9px 12px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6, color: "#166534", fontSize: 13 }}>
              <div>AI values were applied to the draft. Review them before saving.</div>
              {applyNotice.applied.length > 0 && <div>Applied: {applyNotice.applied.join(", ")}.</div>}
              {applyNotice.skipped.length > 0 && (
                <div style={{ color: "#92400e", marginTop: 4 }}>
                  The following non-empty draft fields were not overwritten: {applyNotice.skipped.join(", ")}.
                </div>
              )}
              {applyNotice.warnings.length > 0 && (
                <div style={{ color: "#92400e", marginTop: 4 }}>Could not apply: {applyNotice.warnings.join(", ")}.</div>
              )}
            </div>
          )}
          {vendorCandidates.length > 1 && (
            <div style={{ marginTop: 10, padding: "9px 12px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, color: "#92400e", fontSize: 13 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Multiple vendors match. Select one or merge duplicates from Vendor settings.</div>
              {vendorCandidates.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  onClick={() => {
                    setForm((current) => ({ ...current, vendorId: String(candidate.id), newVendorName: "", newVendorTaxId: "" }));
                    setAddVendor(false);
                    setVendorCandidates([]);
                    setSaved(false);
                  }}
                  style={{ display: "block", width: "100%", textAlign: "left", marginTop: 5, padding: "7px 9px", border: "1px solid #fde68a", borderRadius: 5, background: "#fff", cursor: "pointer" }}
                >
                  {candidate.name} {candidate.taxId ? `· ${candidate.taxId}` : ""} · {candidate.invoiceCount} invoice{candidate.invoiceCount === 1 ? "" : "s"}
                </button>
              ))}
            </div>
          )}
        </div>

        {aiExtraction && <AiExtractionPreview extraction={aiExtraction} />}

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
                  <select style={{ ...inputStyle, flex: 1 }} value={form.vendorId} onChange={(event) => {
                    set("vendorId")(event);
                    setVendorCandidates([]);
                  }}>
                    <option value="">-- select vendor --</option>
                    {vendorOptions.map((v) => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => {
                      setAddVendor(true);
                      setVendorCandidates([]);
                      setForm((current) => ({ ...current, vendorId: "" }));
                    }}
                    style={{ padding: "8px 12px", border: "1px solid #e2e8f0", borderRadius: 6, background: "#f8fafc", cursor: "pointer", fontSize: 13 }}
                    type="button"
                  >
                    + New
                  </button>
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 160px auto", gap: 8 }}>
                  <input style={inputStyle} placeholder="Vendor name" aria-label="New vendor name" value={form.newVendorName} onChange={set("newVendorName")} />
                  <input style={inputStyle} placeholder="VAT / Tax ID" aria-label="New vendor VAT or Tax ID" value={form.newVendorTaxId} onChange={set("newVendorTaxId")} />
                  <button
                    onClick={() => {
                      setAddVendor(false);
                      setForm((current) => ({ ...current, newVendorName: "", newVendorTaxId: "" }));
                    }}
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

          <InvoiceLinesEditor
            lines={editableLines}
            invoiceNetAmount={form.netAmount}
            onChange={(nextLines) => {
              setEditableLines(nextLines);
              setSaved(false);
            }}
          />

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
                  <option key={a.id} value={a.id}>{"— ".repeat(a.depth)}{a.code} · {a.name}</option>
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

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
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
            {!isApproved && (
              <button
                type="button"
                onClick={() => {
                  setDeleteError("");
                  setDeleteOpen(true);
                }}
                disabled={saving || deleting}
                style={{
                  padding: "10px 20px",
                  marginLeft: "auto",
                  background: "#dc2626",
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  cursor: saving || deleting ? "default" : "pointer",
                  fontSize: 14,
                  fontWeight: 600,
                  opacity: saving || deleting ? 0.6 : 1,
                }}
              >
                Delete invoice
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
      {deleteOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-invoice-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 100,
            background: "rgba(15, 23, 42, 0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <div style={{ width: "100%", maxWidth: 460, background: "#fff", borderRadius: 10, padding: 24, boxShadow: "0 20px 50px rgba(15, 23, 42, 0.25)" }}>
            <h2 id="delete-invoice-title" style={{ margin: 0, fontSize: 18, color: "#991b1b" }}>Delete invoice</h2>
            {form.invoiceNumber && (
              <div style={{ marginTop: 10, fontSize: 14, color: "#475569" }}>Invoice number: <strong>{form.invoiceNumber}</strong></div>
            )}
            <p style={{ margin: "14px 0 0", color: "#334155", lineHeight: 1.5 }}>
              Are you sure you want to delete this invoice? This action cannot be undone.
            </p>
            {deleteError && (
              <div style={{ marginTop: 14, padding: "9px 12px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, color: "#b91c1c", fontSize: 13 }}>
                {deleteError}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 22 }}>
              <button
                type="button"
                onClick={() => setDeleteOpen(false)}
                disabled={deleting}
                style={{ padding: "9px 14px", border: "1px solid #cbd5e1", borderRadius: 6, background: "#fff", cursor: deleting ? "default" : "pointer" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={deleteInvoice}
                disabled={deleting}
                style={{ padding: "9px 14px", border: "none", borderRadius: 6, background: deleting ? "#fca5a5" : "#dc2626", color: "#fff", cursor: deleting ? "default" : "pointer", fontWeight: 600 }}
              >
                {deleting ? "Deleting…" : "Delete invoice"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
