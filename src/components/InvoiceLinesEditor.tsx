"use client";

import type { EditableInvoiceLine } from "@/src/lib/invoice-lines";
import { emptyEditableInvoiceLine, sumInvoiceLineAmounts } from "@/src/lib/invoice-lines";
import { safeParseDecimal, toDecimal } from "@/src/lib/invoice-validation";
import { deriveRecognitionSchedule } from "@/src/lib/recognition";

interface Props {
  lines: EditableInvoiceLine[];
  invoiceNetAmount: string;
  invoiceDate?: string;
  invoiceFxRate?: string;
  invoiceCurrency?: string;
  baseCurrency?: string;
  onChange: (lines: EditableInvoiceLine[]) => void;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 72,
  padding: "6px 7px",
  border: "1px solid #e2e8f0",
  borderRadius: 5,
  fontSize: 12,
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  background: "#fff",
  cursor: "pointer",
};

function RecognitionPreview({
  line,
  invoiceDate,
  fxRate,
  currency,
  baseCurrency,
}: {
  line: EditableInvoiceLine;
  invoiceDate?: string;
  fxRate?: string;
  currency?: string;
  baseCurrency?: string;
}) {
  if (line.recognitionTreatment !== "Prepaid") return null;
  if (!line.netAmount || !line.recognitionStartDate || !line.recognitionEndDate) return null;

  const rows = deriveRecognitionSchedule({
    netAmount: line.netAmount,
    fxRate: fxRate || "1",
    treatment: "Prepaid",
    invoiceDate: invoiceDate || null,
    startDate: line.recognitionStartDate,
    endDate: line.recognitionEndDate,
  });

  if (rows.length === 0) return null;

  const showBase = baseCurrency && currency && currency !== baseCurrency;

  return (
    <div style={{ marginTop: 8, padding: "8px 10px", background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 5 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#0369a1", textTransform: "uppercase", marginBottom: 6 }}>
        Recognition schedule ({rows.length} month{rows.length !== 1 ? "s" : ""})
      </div>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 11 }}>
        <thead>
          <tr style={{ color: "#64748b" }}>
            <th style={{ textAlign: "left", padding: "2px 6px 2px 0" }}>Month</th>
            <th style={{ textAlign: "right", padding: "2px 0 2px 6px" }}>{currency || "Orig"}</th>
            {showBase && <th style={{ textAlign: "right", padding: "2px 0 2px 6px" }}>{baseCurrency}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.month}>
              <td style={{ padding: "1px 6px 1px 0", color: "#334155" }}>{row.month}</td>
              <td style={{ padding: "1px 0 1px 6px", textAlign: "right", color: "#1e293b", fontVariantNumeric: "tabular-nums" }}>{row.origAmount}</td>
              {showBase && <td style={{ padding: "1px 0 1px 6px", textAlign: "right", color: "#0369a1", fontVariantNumeric: "tabular-nums" }}>{row.baseAmount}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function InvoiceLinesEditor({ lines, invoiceNetAmount, invoiceDate, invoiceFxRate, invoiceCurrency, baseCurrency, onChange }: Props) {
  const lineAmountSummary = sumInvoiceLineAmounts(lines);
  const parsedInvoiceNet = safeParseDecimal(invoiceNetAmount);
  const comparableInvoiceNet = parsedInvoiceNet.error ? null : parsedInvoiceNet.value;
  const amountsMismatch = lines.length > 0
    && lineAmountSummary.invalidLineNumbers.length === 0
    && comparableInvoiceNet !== null
    && !toDecimal(lineAmountSummary.sum).equals(toDecimal(comparableInvoiceNet));

  function update(index: number, field: keyof EditableInvoiceLine, value: string) {
    onChange(lines.map((line, lineIndex) => lineIndex === index ? { ...line, [field]: value } : line));
  }

  function updateTreatment(index: number, value: "Immediate" | "Prepaid") {
    onChange(lines.map((line, lineIndex) =>
      lineIndex === index
        ? { ...line, recognitionTreatment: value, recognitionStartDate: "", recognitionEndDate: "" }
        : line
    ));
  }

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em" }}>
          Invoice lines ({lines.length})
        </div>
        <button
          type="button"
          onClick={() => onChange([...lines, emptyEditableInvoiceLine()])}
          style={{ padding: "6px 10px", border: "1px solid #cbd5e1", borderRadius: 6, background: "#fff", cursor: "pointer", fontSize: 12 }}
        >
          + Add line
        </button>
      </div>

      {lines.length === 0 ? (
        <div style={{ padding: 14, border: "1px dashed #cbd5e1", borderRadius: 6, color: "#64748b", fontSize: 13 }}>
          No invoice lines yet. Apply AI extraction or add a line manually.
        </div>
      ) : (
        <div>
          {lines.map((line, index) => (
            <div
              key={line.id ?? `draft-${index}`}
              style={{ border: "1px solid #e2e8f0", borderRadius: 6, padding: 12, marginBottom: 10, background: "#fff" }}
            >
              {/* Row 1: core fields */}
              <div style={{ display: "grid", gridTemplateColumns: "60px 1fr 1fr 90px 70px 90px 90px 90px 90px 60px auto", gap: 6, alignItems: "start" }}>
                <div>
                  <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 2 }}>Line #</div>
                  <input aria-label={`Line ${index + 1} number`} style={inputStyle} value={line.lineNumber} onChange={(e) => update(index, "lineNumber", e.target.value)} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 2 }}>Original description</div>
                  <textarea aria-label={`Line ${index + 1} original description`} style={{ ...inputStyle, minWidth: 0, resize: "vertical" }} value={line.descriptionOriginal} onChange={(e) => update(index, "descriptionOriginal", e.target.value)} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 2 }}>Description</div>
                  <textarea aria-label={`Line ${index + 1} English description`} style={{ ...inputStyle, minWidth: 0, resize: "vertical" }} value={line.description} onChange={(e) => update(index, "description", e.target.value)} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 2 }}>Qty</div>
                  <input aria-label={`Line ${index + 1} quantity`} style={inputStyle} value={line.quantity} onChange={(e) => update(index, "quantity", e.target.value)} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 2 }}>Unit</div>
                  <input aria-label={`Line ${index + 1} unit`} style={inputStyle} value={line.unit} onChange={(e) => update(index, "unit", e.target.value)} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 2 }}>Unit price</div>
                  <input aria-label={`Line ${index + 1} unitPrice`} style={inputStyle} value={line.unitPrice} onChange={(e) => update(index, "unitPrice", e.target.value)} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 2 }}>Net amount</div>
                  <input aria-label={`Line ${index + 1} netAmount`} style={inputStyle} value={line.netAmount} onChange={(e) => update(index, "netAmount", e.target.value)} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 2 }}>VAT rate</div>
                  <input aria-label={`Line ${index + 1} vatRate`} style={inputStyle} value={line.vatRate} onChange={(e) => update(index, "vatRate", e.target.value)} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 2 }}>VAT</div>
                  <input aria-label={`Line ${index + 1} vatAmount`} style={inputStyle} value={line.vatAmount} onChange={(e) => update(index, "vatAmount", e.target.value)} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 2 }}>Page</div>
                  <input aria-label={`Line ${index + 1} sourcePage`} style={inputStyle} value={line.sourcePage} onChange={(e) => update(index, "sourcePage", e.target.value)} />
                </div>
                <div style={{ paddingTop: 18 }}>
                  <button
                    type="button"
                    onClick={() => onChange(lines.filter((_, lineIndex) => lineIndex !== index))}
                    style={{ padding: "6px 8px", border: "1px solid #fecaca", borderRadius: 5, background: "#fff", color: "#dc2626", cursor: "pointer", fontSize: 11 }}
                  >
                    Delete
                  </button>
                </div>
              </div>

              {/* Row 2: recognition + accounting fields */}
              <div style={{ display: "grid", gridTemplateColumns: "130px 140px 140px 1fr", gap: 6, marginTop: 8, alignItems: "start" }}>
                <div>
                  <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 2 }}>Treatment</div>
                  <select
                    aria-label={`Line ${index + 1} recognition treatment`}
                    style={selectStyle}
                    value={line.recognitionTreatment}
                    onChange={(e) => updateTreatment(index, e.target.value as "Immediate" | "Prepaid")}
                  >
                    <option value="Immediate">Immediate</option>
                    <option value="Prepaid">Prepaid</option>
                  </select>
                </div>

                {line.recognitionTreatment === "Prepaid" && (
                  <>
                    <div>
                      <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 2 }}>Recog. start date</div>
                      <input
                        type="date"
                        aria-label={`Line ${index + 1} recognition start date`}
                        style={inputStyle}
                        value={line.recognitionStartDate}
                        onChange={(e) => update(index, "recognitionStartDate", e.target.value)}
                      />
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 2 }}>Recog. end date</div>
                      <input
                        type="date"
                        aria-label={`Line ${index + 1} recognition end date`}
                        style={inputStyle}
                        value={line.recognitionEndDate}
                        onChange={(e) => update(index, "recognitionEndDate", e.target.value)}
                        min={line.recognitionStartDate || undefined}
                      />
                    </div>
                  </>
                )}

                <div style={{ gridColumn: line.recognitionTreatment === "Prepaid" ? "4" : "2 / span 3" }}>
                  <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 2 }}>Accounting account no. (optional)</div>
                  <input
                    aria-label={`Line ${index + 1} accounting account number`}
                    style={inputStyle}
                    value={line.accountingAccountNumber}
                    onChange={(e) => update(index, "accountingAccountNumber", e.target.value)}
                    placeholder="e.g. 6200"
                  />
                </div>
              </div>

              {/* Prepaid date validation hint */}
              {line.recognitionTreatment === "Prepaid" && line.recognitionStartDate && line.recognitionEndDate && line.recognitionEndDate < line.recognitionStartDate && (
                <div style={{ marginTop: 6, padding: "5px 8px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 4, color: "#dc2626", fontSize: 11 }}>
                  End date must be on or after start date.
                </div>
              )}
              {line.recognitionTreatment === "Prepaid" && (!line.recognitionStartDate || !line.recognitionEndDate) && (
                <div style={{ marginTop: 6, padding: "5px 8px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 4, color: "#92400e", fontSize: 11 }}>
                  Start and end dates are required before approval.
                </div>
              )}

              {/* Monthly recognition preview */}
              <RecognitionPreview
                line={line}
                invoiceDate={invoiceDate}
                fxRate={invoiceFxRate}
                currency={invoiceCurrency}
                baseCurrency={baseCurrency}
              />
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 12, padding: 12, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 13 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
          <span style={{ color: "#475569" }}>Sum of invoice lines</span>
          <strong style={{ color: "#1e293b" }}>{lineAmountSummary.sum}</strong>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, marginTop: 5 }}>
          <span style={{ color: "#475569" }}>Invoice net amount</span>
          <strong style={{ color: "#1e293b" }}>{(comparableInvoiceNet ?? invoiceNetAmount) || "—"}</strong>
        </div>
        {lineAmountSummary.invalidLineNumbers.length > 0 && (
          <div style={{ marginTop: 9, padding: "8px 10px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 5, color: "#b91c1c" }}>
            Enter a valid line amount for line{lineAmountSummary.invalidLineNumbers.length === 1 ? "" : "s"} {lineAmountSummary.invalidLineNumbers.join(", ")} before comparing totals.
          </div>
        )}
        {amountsMismatch && (
          <div style={{ marginTop: 9, padding: "8px 10px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 5, color: "#92400e" }}>
            The sum of invoice lines does not match the invoice net amount. Review the lines or net amount before saving; neither value was changed automatically.
          </div>
        )}
      </div>
    </div>
  );
}
