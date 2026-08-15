"use client";

import type { EditableInvoiceLine } from "@/src/lib/invoice-lines";
import { emptyEditableInvoiceLine, summarizeInvoiceLineNetAmounts } from "@/src/lib/invoice-lines";
import { safeParseDecimal, toDecimal } from "@/src/lib/invoice-validation";

interface Props {
  lines: EditableInvoiceLine[];
  invoiceNetAmount: string;
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

export default function InvoiceLinesEditor({ lines, invoiceNetAmount, onChange }: Props) {
  const lineAmountSummary = summarizeInvoiceLineNetAmounts(lines);
  const parsedInvoiceNet = safeParseDecimal(invoiceNetAmount);
  const comparableInvoiceNet = parsedInvoiceNet.error ? null : parsedInvoiceNet.value;
  const amountsMismatch = lines.length > 0
    && lineAmountSummary.isComplete
    && comparableInvoiceNet !== null
    && !toDecimal(lineAmountSummary.sum).equals(toDecimal(comparableInvoiceNet));

  function update(index: number, field: keyof EditableInvoiceLine, value: string) {
    onChange(lines.map((line, lineIndex) => lineIndex === index ? { ...line, [field]: value } : line));
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
        <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 6 }}>
          <table style={{ borderCollapse: "collapse", minWidth: 1320, width: "100%" }}>
            <thead style={{ background: "#f8fafc" }}>
              <tr>
                {["Line", "Original description", "English description", "Quantity", "Unit", "Unit price", "Line amount", "VAT rate", "VAT", "Gross", "Page", ""].map((heading) => (
                  <th key={heading} style={{ padding: "7px", textAlign: "left", fontSize: 11, color: "#64748b", whiteSpace: "nowrap" }}>{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => (
                <tr key={line.id ?? `draft-${index}`} style={{ borderTop: "1px solid #f1f5f9" }}>
                  <td style={{ padding: 6 }}><input aria-label={`Line ${index + 1} number`} style={inputStyle} value={line.lineNumber} onChange={(event) => update(index, "lineNumber", event.target.value)} /></td>
                  <td style={{ padding: 6 }}><textarea aria-label={`Line ${index + 1} original description`} style={{ ...inputStyle, minWidth: 210, resize: "vertical" }} value={line.descriptionOriginal} onChange={(event) => update(index, "descriptionOriginal", event.target.value)} /></td>
                  <td style={{ padding: 6 }}><textarea aria-label={`Line ${index + 1} English description`} style={{ ...inputStyle, minWidth: 210, resize: "vertical" }} value={line.description} onChange={(event) => update(index, "description", event.target.value)} /></td>
                  {(["quantity", "unit", "unitPrice", "netAmount", "vatRate", "vatAmount", "grossAmount", "sourcePage"] as const).map((field) => (
                    <td key={field} style={{ padding: 6 }}>
                      <input aria-label={`Line ${index + 1} ${field}`} style={inputStyle} value={line[field]} onChange={(event) => update(index, field, event.target.value)} />
                    </td>
                  ))}
                  <td style={{ padding: 6 }}>
                    <button
                      type="button"
                      onClick={() => onChange(lines.filter((_, lineIndex) => lineIndex !== index))}
                      style={{ padding: "6px 8px", border: "1px solid #fecaca", borderRadius: 5, background: "#fff", color: "#dc2626", cursor: "pointer", fontSize: 11 }}
                    >
                      Delete line
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: 12, padding: 12, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 13 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
          <span style={{ color: "#475569" }}>Sum of invoice lines</span>
          <strong style={{ color: "#1e293b" }}>{lineAmountSummary.sum ?? "Incomplete / unavailable"}</strong>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, marginTop: 5 }}>
          <span style={{ color: "#475569" }}>Invoice net amount</span>
          <strong style={{ color: "#1e293b" }}>{(comparableInvoiceNet ?? invoiceNetAmount) || "—"}</strong>
        </div>
        {lineAmountSummary.invalidLineNumbers.length > 0 && (
          <div style={{ marginTop: 9, padding: "8px 10px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 5, color: "#b91c1c" }}>
            Enter a valid line net amount for line{lineAmountSummary.invalidLineNumbers.length === 1 ? "" : "s"} {lineAmountSummary.invalidLineNumbers.join(", ")} before comparing totals.
          </div>
        )}
        {lineAmountSummary.missingLineNumbers.length > 0 && (
          <div style={{ marginTop: 9, padding: "8px 10px", background: "#f8fafc", border: "1px solid #cbd5e1", borderRadius: 5, color: "#475569" }}>
            Line-net total is incomplete because net amounts are unavailable for line{lineAmountSummary.missingLineNumbers.length === 1 ? "" : "s"} {lineAmountSummary.missingLineNumbers.join(", ")}.
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
