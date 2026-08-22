"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { safeIsAmountMismatch, safeCalculateBaseAmount, safeParseDecimal, formatDisplayAmount, toDecimal, stripTrailingZeros } from "@/src/lib/invoice-validation";
import type { AiInvoiceExtraction } from "@/src/lib/ai-extraction";
import type { AiInvoiceReconciliationInfo } from "@/src/lib/ai-invoice-reconciliation";
import type { EditableInvoiceLine } from "@/src/lib/invoice-lines";
import { editableLineToInput, applyAutoCalcToLine, isCompletelyEmptyLine, parsePageInput, checkLineTotalsForApproval, fillMissingLineNumbers } from "@/src/lib/invoice-lines";
import { buildTextExtractionFallbackLine } from "@/src/lib/local-invoice-parser";
import { applyExtractionLines, applyExtractionToDraft, extractionLinesToEditable } from "@/src/lib/apply-ai-extraction";
import InvoiceLinesEditor from "@/src/components/InvoiceLinesEditor";
import { selectableExpenseAccounts, selectablePrepaidAssetAccounts } from "@/src/lib/coa-hierarchy";
import { useI18n } from "@/src/i18n/context";
import { buildInvoiceDiagnosticsText, extractValidationErrorFields } from "@/src/lib/invoice-diagnostics";

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
  lineNetAdjustment: string;
  vatAmount: string | null;
  grossAmount: string | null;
  baseNetAmount: string | null;
  baseVatAmount: string | null;
  baseGrossAmount: string | null;
  costCentreId: number | null;
  expenseAccountId: number | null;
  notes: string | null;
  status: "draft" | "approved";
  paymentStatus: "Unpaid" | "Paid";
  paidDate: string | null;
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

const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "CAD", "AUD", "JPY", "SEK", "NOK", "DKK", "ILS", "RON", "BTC", "ETH", "USDT", "USDC"];

function field(label: string, children: React.ReactNode, hint?: string) {
  return (
    <div style={{ marginBottom: 16 }} className="invoice-field-group">
      <label className="invoice-field-label" style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>
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

function validateMonetaryFields(form: { netAmount: string; lineNetAdjustment: string; vatAmount: string; grossAmount: string; fxRateToBase: string }): string[] {
  const fieldErrors: string[] = [];
  if (form.netAmount) {
    const r = safeParseDecimal(form.netAmount);
    if (r.error) fieldErrors.push(`Net: ${r.error}`);
  }
  if (form.lineNetAdjustment) {
    const r = safeParseDecimal(form.lineNetAdjustment);
    if (r.error) fieldErrors.push(`Adjustment: ${r.error}`);
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

function AiReconciliationBanner({ reconciliation }: { reconciliation: AiInvoiceReconciliationInfo }) {
  const { t } = useI18n();
  const ir = t.invoiceReview;
  const { kind } = reconciliation;

  if (kind === "matched" || kind === "not-applicable") return null;

  const isWarning = kind === "minor-difference" || kind === "review-required";
  const bannerStyle: React.CSSProperties = {
    padding: "10px 14px",
    borderRadius: 6,
    fontSize: 13,
    marginBottom: 12,
    background: isWarning ? "#fffbeb" : "#eff6ff",
    border: `1px solid ${isWarning ? "#fde68a" : "#bfdbfe"}`,
    color: isWarning ? "#92400e" : "#1e3a5f",
  };

  let message = "";
  if (kind === "vat-prorated") message = ir.aiReconciliationVatProrated;
  else if (kind === "gross-reclassified") message = ir.aiReconciliationGrossReclassified;
  else if (kind === "minor-difference") message = ir.aiReconciliationMinorDiff;
  else if (kind === "review-required") message = ir.aiReconciliationReviewRequired;

  const diffs: string[] = [];
  if (reconciliation.netDifference != null) diffs.push(`Net: ${reconciliation.netDifference}`);
  if (reconciliation.vatDifference != null) diffs.push(`VAT: ${reconciliation.vatDifference}`);
  if (reconciliation.grossDifference != null) diffs.push(`Gross: ${reconciliation.grossDifference}`);

  return (
    <div style={bannerStyle}>
      <div>{message}</div>
      {diffs.length > 0 && (
        <div style={{ marginTop: 4, fontSize: 12, opacity: 0.85 }}>{diffs.join(" · ")}</div>
      )}
    </div>
  );
}

function AiExtractionPreview({
  extraction,
  reconciliation,
}: {
  extraction: AiInvoiceExtraction;
  reconciliation: AiInvoiceReconciliationInfo | null;
}) {
  const { t } = useI18n();
  const ir = t.invoiceReview;

  const headerFields: Array<[string, string | null]> = [
    [ir.aiFieldVendorOriginal, extraction.vendorOriginal],
    [ir.aiFieldVendorEnglish, extraction.vendorNormalized],
    [ir.aiFieldVendorTaxId, extraction.vendorTaxId],
    [ir.aiFieldInvoiceNumber, extraction.invoiceNumber],
    [ir.aiFieldInvoiceDate, extraction.invoiceDate],
    [ir.aiFieldDueDate, extraction.dueDate],
    [ir.aiFieldCurrency, extraction.currency],
    [ir.aiFieldNetAmount, extraction.netAmount],
    [ir.aiFieldVatAmount, extraction.vatAmount],
    [ir.aiFieldGrossAmount, extraction.grossAmount],
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
        <div style={{ fontWeight: 700, color: "#1e3a5f" }}>{ir.aiPreviewTitle}</div>
      </div>

      <div style={{ padding: 16 }}>
        {reconciliation && <AiReconciliationBanner reconciliation={reconciliation} />}
        <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 10 }}>
          {ir.aiPreviewHeader}
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
          {t.invoiceLines.titleWithCount.replace("{count}", String(extraction.lines.length))}
        </div>
        {extraction.lines.length === 0 ? (
          <div style={{ color: "#64748b", fontSize: 13 }}>{ir.aiNoLinesFound}</div>
        ) : (
          <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 6 }}>
            <table style={{ borderCollapse: "collapse", minWidth: 1180, width: "100%", textAlign: "left" }}>
              <thead style={{ background: "#f8fafc", color: "#475569" }}>
                <tr>
                  {[
                    ir.aiColNum, ir.aiColLine, ir.aiColDescOriginal, ir.aiColDescEnglish, ir.aiColQty, ir.aiColUnit,
                    ir.aiColUnitPrice, ir.aiColNet, ir.aiColVatRate, ir.aiColVat, ir.aiColGross, ir.aiColPage,
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
  const { t, locale } = useI18n();
  const ir = t.invoiceReview;
  const cm = t.common;

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
    fxRateToBase: stripTrailingZeros(invoice.fxRateToBase) || (isSameCurrency ? "1" : ""),
    netAmount: stripTrailingZeros(invoice.netAmount) || extractedFields.netAmount || "",
    lineNetAdjustment: stripTrailingZeros(invoice.lineNetAdjustment),
    vatAmount: stripTrailingZeros(invoice.vatAmount) || extractedFields.vatAmount || "",
    grossAmount: stripTrailingZeros(invoice.grossAmount) || extractedFields.grossAmount || "",
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
  const [aiReconciliation, setAiReconciliation] = useState<AiInvoiceReconciliationInfo | null>(null);
  const [editableLines, setEditableLines] = useState<EditableInvoiceLine[]>(() => {
    const fallback = buildTextExtractionFallbackLine(
      lines.length,
      invoice.netAmount,
      invoice.vatAmount,
      invoice.grossAmount,
      extractedFields,
    );
    return fillMissingLineNumbers(fallback ? [fallback] : lines);
  });
  const [lastAppliedLineSignature, setLastAppliedLineSignature] = useState<string | null>(null);
  const [applyNotice, setApplyNotice] = useState<{ applied: string[]; skipped: string[]; warnings: string[] } | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [paymentStatus, setPaymentStatus] = useState<"Unpaid" | "Paid">(invoice.paymentStatus ?? "Unpaid");
  const [paidDate, setPaidDate] = useState(invoice.paidDate ?? "");
  const [pendingPaidDate, setPendingPaidDate] = useState(invoice.paidDate ?? "");
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const [diagnosticsFeedback, setDiagnosticsFeedback] = useState<"copied" | "failed" | null>(null);

  const doc = documents[0];
  const isPdfDocument = doc?.mimeType === "application/pdf";

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
    if (hasInvalidPage) {
      setSaveError(ir.fixInvalidPages);
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      const linesToSave = editableLines.filter((l) => !isCompletelyEmptyLine(l));
      const body: Record<string, unknown> = {
        invoiceNumber: form.invoiceNumber || null,
        invoiceDate: form.invoiceDate || null,
        dueDate: form.dueDate || null,
        currency: form.currency,
        currencyType: form.currencyType,
        fxRateToBase: form.fxRateToBase || null,
        netAmount: form.netAmount || null,
        lineNetAdjustment: form.lineNetAdjustment || "0",
        vatAmount: form.vatAmount || null,
        grossAmount: form.grossAmount || null,
        costCentreId: form.costCentreId ? Number(form.costCentreId) : null,
        notes: form.notes || null,
        lines: linesToSave.map((line) => editableLineToInput(line)),
      };

      if (linesToSave.length === 0) {
        body.expenseAccountId = form.expenseAccountId ? Number(form.expenseAccountId) : null;
      }

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

  async function tryAiExtraction(forceImage = false) {
    setExtracting(true);
    setExtractionError("");
    setAiExtraction(null);
    setAiReconciliation(null);
    setApplyNotice(null);
    setVendorCandidates([]);
    try {
      const endpoint = `/api/invoices/${invoice.id}/extract${forceImage ? "?mode=image" : ""}`;
      const response = await fetch(endpoint, { method: "POST" });
      let json: { error?: unknown; extraction?: AiInvoiceExtraction; reconciliation?: AiInvoiceReconciliationInfo };
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
      setAiReconciliation(json.reconciliation ?? null);
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
    const skipped = draftResult.skippedFields.filter((f) => !f.includes("(unrecognized date)"));
    const warnings = draftResult.skippedFields.filter((f) => f.includes("(unrecognized date)"));
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

  async function markPaid() {
    setPaymentSaving(true);
    setPaymentError("");
    try {
      const res = await fetch(`/api/invoices/${invoice.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentStatus: "Paid", paidDate: pendingPaidDate || null }),
      });
      const json = await res.json() as { error?: unknown };
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Failed to update payment status");
      setPaymentStatus("Paid");
      setPaidDate(pendingPaidDate);
      router.refresh();
    } catch (err) {
      setPaymentError(err instanceof Error ? err.message : "Failed to update payment status");
    } finally {
      setPaymentSaving(false);
    }
  }

  async function savePaidDate() {
    setPaymentSaving(true);
    setPaymentError("");
    try {
      const res = await fetch(`/api/invoices/${invoice.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paidDate: pendingPaidDate || null }),
      });
      const json = await res.json() as { error?: unknown };
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Failed to save paid date");
      setPaidDate(pendingPaidDate);
      router.refresh();
    } catch (err) {
      setPaymentError(err instanceof Error ? err.message : "Failed to save paid date");
    } finally {
      setPaymentSaving(false);
    }
  }

  async function markUnpaid() {
    setPaymentSaving(true);
    setPaymentError("");
    try {
      const res = await fetch(`/api/invoices/${invoice.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentStatus: "Unpaid" }),
      });
      const json = await res.json() as { error?: unknown };
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Failed to update payment status");
      setPaymentStatus("Unpaid");
      setPaidDate("");
      setPendingPaidDate("");
      router.refresh();
    } catch (err) {
      setPaymentError(err instanceof Error ? err.message : "Failed to update payment status");
    } finally {
      setPaymentSaving(false);
    }
  }

  const prepaidLinesInvalid = editableLines.some((line) => {
    if (line.recognitionTreatment !== "Prepaid") return false;
    if (!line.recognitionStartDate || !line.recognitionEndDate) return true;
    if (line.recognitionEndDate < line.recognitionStartDate) return true;
    if (!line.accountingAccountNumber) return true;
    if (!line.prepaidAccountNumber) return true;
    return false;
  });

  const hasInvalidPage = editableLines.some((l) => !!parsePageInput(l.sourcePage).error);

  let headerLineMismatch = false;
  let lineTotalsCheck: "ok" | "net-mismatch" | "vat-mismatch" | "gross-mismatch" | "not-checked" = "not-checked";
  const meaningfulLines = editableLines.filter((l) => !isCompletelyEmptyLine(l));
  if (meaningfulLines.length > 0 && !hasInputErrors) {
    try {
      const calcedLines = meaningfulLines.map(applyAutoCalcToLine);
      const result = checkLineTotalsForApproval(
        calcedLines,
        { net: form.netAmount || null, vat: form.vatAmount || null, gross: form.grossAmount || null },
        form.currencyType,
        form.lineNetAdjustment || "0",
      );
      lineTotalsCheck = result;
      if (result !== "ok") headerLineMismatch = true;
    } catch {
      // ignore arithmetic errors during render
    }
  }

  async function copyDiagnostics() {
    const text = buildInvoiceDiagnosticsText({
      pathname: window.location.pathname,
      invoiceId: invoice.id,
      invoiceStatus: invoice.status,
      paymentStatus,
      documentCount: documents.length,
      editableLineCount: editableLines.length,
      locale,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      userAgent: navigator.userAgent,
      saveError: saveError !== "",
      extractionError: extractionError !== "",
      monetaryValidationErrorFields: extractValidationErrorFields(inputErrors),
      headerArithmeticMismatch: mismatch,
      lineTotalsCheck,
    });
    try {
      await navigator.clipboard.writeText(text);
      setDiagnosticsFeedback("copied");
    } catch {
      setDiagnosticsFeedback("failed");
    }
    window.setTimeout(() => setDiagnosticsFeedback(null), 2500);
  }

  const approveDisabled = saving || mismatch || hasInputErrors || headerLineMismatch || hasInvalidPage || prepaidLinesInvalid;
  const expenseAccounts = selectableExpenseAccounts(accounts);
  const prepaidAssetAccounts = selectablePrepaidAssetAccounts(accounts);

  const paymentStatusLabel = paymentStatus === "Paid" ? cm.statusPaid : cm.statusUnpaid;
  const invoiceStatusLabel = isApproved ? cm.statusApproved : cm.statusDraft;

  return (
    <div className="invoice-layout">
      {/* Narrow-screen: link to open document without the full side panel */}
      {doc && (
        <div className="invoice-doc-link">
          <a
            href={`/api/invoices/${invoice.id}/document`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 14px",
              border: "1px solid #e2e8f0",
              borderRadius: 6,
              background: "#fff",
              color: "#2563eb",
              fontSize: 13,
              fontWeight: 500,
              textDecoration: "none",
            }}
          >
            📄 {t.invoiceDetail.viewDocument}
          </a>
        </div>
      )}

      {/* Document preview (wide screens) */}
      <div
        className="invoice-doc-panel"
        style={{
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
          <span>{ir.originalDocument}</span>
          {doc && (
            <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 400 }}>
              {doc.ocrPerformed ? ir.ocrApplied : ir.textExtracted} · {doc.originalFilename}
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
            {ir.noDocument}
          </div>
        )}
      </div>

      {/* Editable fields */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 700, color: "#1e3a5f", marginBottom: 5 }}>{ir.aiSectionTitle}</div>
          <div style={{ fontSize: 13, lineHeight: 1.5, color: "#475569", marginBottom: 12 }}>
            {ir.aiSectionDesc}
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => tryAiExtraction()}
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
              {extracting ? ir.runningAiExtraction : ir.tryAiExtraction}
            </button>
            {isPdfDocument && (
              <button
                type="button"
                onClick={() => tryAiExtraction(true)}
                disabled={extracting}
                style={{
                  padding: "9px 14px",
                  border: "1px solid #2563eb",
                  borderRadius: 6,
                  background: extracting ? "#f1f5f9" : "#fff",
                  color: extracting ? "#94a3b8" : "#2563eb",
                  cursor: extracting ? "default" : "pointer",
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                {ir.tryImageAi}
              </button>
            )}
            {aiExtraction && (
              <button
                type="button"
                onClick={applyAiExtraction}
                style={{ padding: "9px 14px", border: "none", borderRadius: 6, background: "#16a34a", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700 }}
              >
                {ir.applyAiExtraction}
              </button>
            )}
          </div>
          {aiExtraction && !applyNotice && (
            <div style={{ marginTop: 10, color: "#475569", fontSize: 13 }}>
              {ir.reviewThenApply}
            </div>
          )}
          {!doc && <div style={{ marginTop: 8, color: "#64748b", fontSize: 12 }}>{ir.attachFirst}</div>}
          {extractionError && (
            <div style={{ marginTop: 12, padding: "9px 12px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, color: "#b91c1c", fontSize: 13 }}>
              {extractionError}
            </div>
          )}
          {applyNotice && (
            <div style={{ marginTop: 12, padding: "9px 12px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6, color: "#166534", fontSize: 13 }}>
              <div>{ir.aiApplied}</div>
              {applyNotice.applied.length > 0 && <div>{ir.aiAppliedFields} {applyNotice.applied.join(", ")}.</div>}
              {applyNotice.skipped.length > 0 && (
                <div style={{ color: "#92400e", marginTop: 4 }}>
                  {ir.aiNotApplied} {applyNotice.skipped.join(", ")}.
                </div>
              )}
              {applyNotice.warnings.length > 0 && (
                <div style={{ color: "#92400e", marginTop: 4 }}>{ir.aiCouldNotApply} {applyNotice.warnings.join(", ")}.</div>
              )}
            </div>
          )}
          {vendorCandidates.length > 1 && (
            <div style={{ marginTop: 10, padding: "9px 12px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, color: "#92400e", fontSize: 13 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>{ir.multipleVendors}</div>
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

        {aiExtraction && <AiExtractionPreview extraction={aiExtraction} reconciliation={aiReconciliation} />}

        <div
          className="invoice-details-card"
          style={{
            background: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            padding: 24,
          }}
        >
          <div className="invoice-details-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "#1e3a5f" }}>{ir.invoiceDetails}</h2>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                type="button"
                onClick={copyDiagnostics}
                aria-label={ir.copyDiagnostics}
                title={ir.copyDiagnostics}
                style={{
                  width: 28,
                  height: 28,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 0,
                  border: "1px solid #e2e8f0",
                  borderRadius: 6,
                  background: "transparent",
                  color: "#94a3b8",
                  cursor: "pointer",
                }}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <rect x="5" y="3" width="8" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
                  <path d="M3 11V2.5A1.5 1.5 0 0 1 4.5 1H11" stroke="currentColor" strokeWidth="1.4" />
                </svg>
              </button>
              {diagnosticsFeedback && (
                <span role="status" style={{ fontSize: 12, color: diagnosticsFeedback === "copied" ? "#16a34a" : "#dc2626" }}>
                  {diagnosticsFeedback === "copied" ? ir.diagnosticsCopied : ir.diagnosticsCopyFailed}
                </span>
              )}
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
                {invoiceStatusLabel}
              </span>
              <span
                style={{
                  padding: "3px 12px",
                  borderRadius: 12,
                  fontSize: 12,
                  fontWeight: 600,
                  background: paymentStatus === "Paid" ? "#dcfce7" : "#f1f5f9",
                  color: paymentStatus === "Paid" ? "#166534" : "#475569",
                }}
              >
                {paymentStatusLabel}
              </span>
            </div>
          </div>

          {/* Payment status controls */}
          <div className="invoice-payment-section" style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 12, marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              {ir.payment}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {paymentStatus === "Unpaid" ? (
                <>
                  <input
                    type="date"
                    aria-label={ir.paidDateLabel}
                    value={pendingPaidDate}
                    onChange={(e) => setPendingPaidDate(e.target.value)}
                    style={{ padding: "6px 8px", border: "1px solid #e2e8f0", borderRadius: 5, fontSize: 13 }}
                  />
                  <button
                    type="button"
                    onClick={markPaid}
                    disabled={paymentSaving}
                    style={{ padding: "6px 14px", border: "none", borderRadius: 5, background: paymentSaving ? "#cbd5e1" : "#16a34a", color: "#fff", cursor: paymentSaving ? "default" : "pointer", fontSize: 13, fontWeight: 600 }}
                  >
                    {ir.markPaid}
                  </button>
                </>
              ) : (
                <>
                  <input
                    type="date"
                    aria-label={ir.paidDateLabel}
                    value={pendingPaidDate}
                    onChange={(e) => setPendingPaidDate(e.target.value)}
                    style={{ padding: "6px 8px", border: "1px solid #e2e8f0", borderRadius: 5, fontSize: 13 }}
                  />
                  {pendingPaidDate !== paidDate && (
                    <button
                      type="button"
                      onClick={savePaidDate}
                      disabled={paymentSaving}
                      style={{ padding: "6px 14px", border: "none", borderRadius: 5, background: paymentSaving ? "#cbd5e1" : "#2563eb", color: "#fff", cursor: paymentSaving ? "default" : "pointer", fontSize: 13, fontWeight: 600 }}
                    >
                      {ir.saveDate}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={markUnpaid}
                    disabled={paymentSaving}
                    style={{ padding: "6px 14px", border: "1px solid #e2e8f0", borderRadius: 5, background: paymentSaving ? "#f1f5f9" : "#fff", color: "#475569", cursor: paymentSaving ? "default" : "pointer", fontSize: 13 }}
                  >
                    {ir.markUnpaid}
                  </button>
                </>
              )}
            </div>
            {paymentError && (
              <div style={{ marginTop: 8, padding: "6px 10px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 5, color: "#dc2626", fontSize: 12 }}>
                {paymentError}
              </div>
            )}
          </div>

          {/* Vendor */}
          {field(
            ir.vendor,
            <>
              {!addVendor ? (
                <div style={{ display: "flex", gap: 8 }}>
                  <select style={{ ...inputStyle, flex: 1 }} value={form.vendorId} onChange={(event) => {
                    set("vendorId")(event);
                    setVendorCandidates([]);
                  }}>
                    <option value="">{ir.selectVendor}</option>
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
                    {ir.newVendorBtn}
                  </button>
                </div>
              ) : (
                <div className="invoice-vendor-new-grid" style={{ display: "grid", gridTemplateColumns: "1fr 160px auto", gap: 8 }}>
                  <input style={inputStyle} placeholder={ir.vendorNamePlaceholder} aria-label="New vendor name" value={form.newVendorName} onChange={set("newVendorName")} />
                  <input style={inputStyle} placeholder={ir.vatTaxId} aria-label="New vendor VAT or Tax ID" value={form.newVendorTaxId} onChange={set("newVendorTaxId")} />
                  <button
                    onClick={() => {
                      setAddVendor(false);
                      setForm((current) => ({ ...current, newVendorName: "", newVendorTaxId: "" }));
                    }}
                    style={{ padding: "8px 12px", border: "1px solid #e2e8f0", borderRadius: 6, background: "#f8fafc", cursor: "pointer", fontSize: 13 }}
                    type="button"
                  >
                    {cm.cancel}
                  </button>
                </div>
              )}
            </>
          )}

          {/* Invoice number + date */}
          <div className="invoice-field-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {field(ir.invoiceNumber, <input style={inputStyle} value={form.invoiceNumber} onChange={set("invoiceNumber")} placeholder="INV-001" />)}
            {field(ir.invoiceDate, <input style={inputStyle} type="date" value={form.invoiceDate} onChange={set("invoiceDate")} />)}
          </div>

          <div className="invoice-field-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {field(ir.dueDate, <input style={inputStyle} type="date" value={form.dueDate} onChange={set("dueDate")} />)}
            {field(
              ir.currency,
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

          <div className="invoice-field-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {field(
              ir.currencyType,
              <select style={inputStyle} value={form.currencyType} onChange={set("currencyType")}>
                <option value="fiat">{ir.fiat}</option>
                <option value="crypto">{ir.crypto}</option>
              </select>,
              ir.currencyTypeHint
            )}
            {field(
              ir.fxRateToBase,
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
                ? ir.fxSameCurrency
                : ir.fxHint.replace("{currency}", form.currency).replace("{base}", baseCurrency)
            )}
          </div>

          {/* Amounts */}
          <div className="invoice-amounts-section" style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <div className="invoice-section-header" style={{ fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              {ir.amountsTitle.replace("{currency}", form.currency)}
            </div>
            <div className="invoice-amounts-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, color: "#64748b", marginBottom: 4 }}>{ir.netAmount}</label>
                <input
                  style={form.netAmount && safeParseDecimal(form.netAmount).error ? errorInputStyle : inputStyle}
                  value={form.netAmount}
                  onChange={set("netAmount")}
                  placeholder="0.00"
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, color: "#64748b", marginBottom: 4 }}>{ir.vatAmount}</label>
                <input
                  style={form.vatAmount && safeParseDecimal(form.vatAmount).error ? errorInputStyle : inputStyle}
                  value={form.vatAmount}
                  onChange={set("vatAmount")}
                  placeholder="0.00"
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, color: "#64748b", marginBottom: 4 }}>
                  {ir.grossAmount}
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
                {form.currencyType === "fiat" ? ir.mismatchFiat : ir.mismatchCrypto}
              </div>
            )}
          </div>

          <InvoiceLinesEditor
            lines={editableLines}
            postingAccounts={expenseAccounts}
            prepaidAccounts={prepaidAssetAccounts}
            invoiceNetAmount={form.netAmount}
            lineNetAdjustment={form.lineNetAdjustment}
            invoiceDate={form.invoiceDate}
            invoiceFxRate={form.fxRateToBase || undefined}
            invoiceCurrency={form.currency}
            baseCurrency={baseCurrency}
            currencyType={form.currencyType}
            onLineNetAdjustmentChange={(lineNetAdjustment) => {
              setForm((current) => ({ ...current, lineNetAdjustment }));
              setSaved(false);
            }}
            onChange={(nextLines) => {
              setEditableLines(nextLines);
              setSaved(false);
            }}
          />

          {/* Base amounts (read-only) */}
          {showBaseAmounts && (
            <div className="invoice-base-amounts-section" style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <div className="invoice-section-header" style={{ fontSize: 12, fontWeight: 600, color: "#0369a1", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                {ir.baseAmountsTitle.replace("{currency}", baseCurrency)}
              </div>
              <div className="invoice-amounts-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12, color: "#64748b", marginBottom: 4 }}>{ir.baseNet}</label>
                  <input style={readOnlyStyle} value={previewBaseNet ? formatDisplayAmount(previewBaseNet, "fiat") : ""} readOnly />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, color: "#64748b", marginBottom: 4 }}>{ir.baseVat}</label>
                  <input style={readOnlyStyle} value={previewBaseVat ? formatDisplayAmount(previewBaseVat, "fiat") : ""} readOnly />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, color: "#64748b", marginBottom: 4 }}>{ir.baseGross}</label>
                  <input style={readOnlyStyle} value={previewBaseGross ? formatDisplayAmount(previewBaseGross, "fiat") : ""} readOnly />
                </div>
              </div>
              {!currentIsSameCurrency && !form.fxRateToBase && (
                <div style={{ marginTop: 8, fontSize: 12, color: "#0369a1" }}>
                  {ir.enterFxRate}
                </div>
              )}
            </div>
          )}

          {/* Cost centre + account */}
          <div className="invoice-field-row" style={{ display: "grid", gridTemplateColumns: editableLines.length > 0 ? "1fr" : "1fr 1fr", gap: 16 }}>
            {field(
              ir.costCentre,
              <select style={inputStyle} value={form.costCentreId} onChange={set("costCentreId")}>
                <option value="">{cm.selectNone}</option>
                {costCentres.map((c) => (
                  <option key={c.id} value={c.id}>{c.code} · {c.name}</option>
                ))}
              </select>
            )}
            {editableLines.length === 0 && field(
              ir.expenseAccount,
              <select style={inputStyle} value={form.expenseAccountId} onChange={set("expenseAccountId")}>
                <option value="">{cm.selectNone}</option>
                {expenseAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{"— ".repeat(a.depth)}{a.code} · {a.name}</option>
                ))}
              </select>
            )}
          </div>

          {field(
            ir.notes,
            <textarea
              style={{ ...inputStyle, minHeight: 64, resize: "vertical" }}
              value={form.notes}
              onChange={set("notes")}
              placeholder={ir.notesPlaceholder}
            />
          )}

          {saveError && (
            <div style={{ marginBottom: 16, padding: "10px 14px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, color: "#dc2626", fontSize: 13 }}>
              {saveError}
            </div>
          )}
          {saved && (
            <div style={{ marginBottom: 16, padding: "10px 14px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6, color: "#16a34a", fontSize: 13 }}>
              {isApproved ? ir.changesSaved : ir.draftSaved}
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
              {saving ? cm.saving : (isApproved ? ir.saveChanges : ir.saveDraft)}
            </button>
            {!isApproved && (
              <button
                onClick={() => save("approve")}
                disabled={approveDisabled}
                title={
                  hasInputErrors ? ir.approveDisabledInvalid
                    : mismatch ? ir.approveDisabledMismatch
                    : headerLineMismatch ? ir.approveDisabledLines
                    : hasInvalidPage ? ir.approveDisabledPages
                    : prepaidLinesInvalid ? ir.approveDisabledPrepaid
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
                {ir.approveInvoice}
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
                {ir.deleteInvoice}
              </button>
            )}
          </div>
          {!isApproved && (hasInputErrors || mismatch || headerLineMismatch || hasInvalidPage || prepaidLinesInvalid) && (
            <div style={{ marginTop: 8, fontSize: 12, color: "#d97706" }}>
              {hasInputErrors
                ? ir.approveDisabledInvalid
                : mismatch
                ? ir.approveDisabledMismatch
                : headerLineMismatch
                ? ir.approveDisabledLines
                : hasInvalidPage
                ? ir.approveDisabledPages
                : ir.approveDisabledPrepaid}
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
            <h2 id="delete-invoice-title" style={{ margin: 0, fontSize: 18, color: "#991b1b" }}>{ir.deleteTitle}</h2>
            {form.invoiceNumber && (
              <div style={{ marginTop: 10, fontSize: 14, color: "#475569" }}>{ir.deleteInvoiceNumberLabel} <strong>{form.invoiceNumber}</strong></div>
            )}
            <p style={{ margin: "14px 0 0", color: "#334155", lineHeight: 1.5 }}>
              {ir.deleteConfirmText}
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
                {cm.cancel}
              </button>
              <button
                type="button"
                onClick={deleteInvoice}
                disabled={deleting}
                style={{ padding: "9px 14px", border: "none", borderRadius: 6, background: deleting ? "#fca5a5" : "#dc2626", color: "#fff", cursor: deleting ? "default" : "pointer", fontWeight: 600 }}
              >
                {deleting ? cm.deleting : ir.confirmDelete}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
