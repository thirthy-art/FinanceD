"use client";

import type { EditableInvoiceLine } from "@/src/lib/invoice-lines";
import { emptyEditableInvoiceLine } from "@/src/lib/invoice-lines";

interface Props {
  lines: EditableInvoiceLine[];
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

export default function InvoiceLinesEditor({ lines, onChange }: Props) {
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
                {["Line", "Original description", "English description", "Qty", "Unit", "Unit price", "Net", "VAT rate", "VAT", "Gross", "Page", ""].map((heading) => (
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
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
