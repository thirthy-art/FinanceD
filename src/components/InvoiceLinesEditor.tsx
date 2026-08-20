"use client";

import type { EditableInvoiceLine } from "@/src/lib/invoice-lines";
import { emptyEditableInvoiceLine, sumInvoiceLineAmounts, applyAutoCalcToLine, parsePageInput } from "@/src/lib/invoice-lines";
import { safeParseDecimal, amountsWithinTolerance, FIAT_TOLERANCE, stripTrailingZeros } from "@/src/lib/invoice-validation";
import { Decimal } from "@/src/lib/decimal";
import { deriveRecognitionSchedule } from "@/src/lib/recognition";
import { useI18n } from "@/src/i18n/context";

interface Props {
  lines: EditableInvoiceLine[];
  postingAccounts: Array<{ code: string; name: string }>;
  prepaidAccounts?: Array<{ code: string; name: string }>;
  invoiceNetAmount: string;
  invoiceDate?: string;
  invoiceFxRate?: string;
  invoiceCurrency?: string;
  baseCurrency?: string;
  currencyType?: "fiat" | "crypto";
  onChange: (lines: EditableInvoiceLine[]) => void;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 7px",
  border: "1px solid #e2e8f0",
  borderRadius: 5,
  fontSize: 12,
};

const derivedStyle: React.CSSProperties = {
  ...inputStyle,
  background: "#f0f9ff",
  color: "#0369a1",
  border: "1px solid #93c5fd",
};

const errorInputStyle: React.CSSProperties = {
  ...inputStyle,
  borderColor: "#ef4444",
  background: "#fef2f2",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  background: "#fff",
  cursor: "pointer",
};

function fieldInputStyle(_raw: string, derived: boolean, hasError: boolean): React.CSSProperties {
  if (hasError) return errorInputStyle;
  if (derived) return derivedStyle;
  return inputStyle;
}

function mismatchExceedsTolerance(a: Decimal, b: Decimal, currencyType: "fiat" | "crypto"): boolean {
  const diff = a.minus(b).abs();
  if (currencyType === "crypto") return !diff.isZero();
  return diff.greaterThan(FIAT_TOLERANCE);
}

function computeLineDisplay(line: EditableInvoiceLine, currencyType: "fiat" | "crypto"): {
  display: EditableInvoiceLine;
  netDerived: boolean;
  vatDerived: boolean;
  grossDerived: boolean;
  netError: string | null;
  vatAmtError: string | null;
  grossError: string | null;
  qtyError: string | null;
  upError: string | null;
  vatRateError: string | null;
  vatRateOutOfRange: boolean;
  qtyNetMismatch: boolean;
  vatMismatch: boolean;
  grossMismatch: boolean;
  pageError: string | null;
} {
  const display = applyAutoCalcToLine(line);

  const netBlank = !line.netAmount.trim();
  const vatBlank = !line.vatAmount.trim();
  const grossBlank = !line.grossAmount.trim();

  const netDerived = netBlank && display.netAmount !== "";
  const vatDerived = vatBlank && display.vatAmount !== "";
  const grossDerived = grossBlank && display.grossAmount !== "";

  const netError = !netBlank ? safeParseDecimal(line.netAmount).error : null;
  const vatAmtError = !vatBlank ? safeParseDecimal(line.vatAmount).error : null;
  const grossError = !grossBlank ? safeParseDecimal(line.grossAmount).error : null;
  const qtyError = line.quantity.trim() ? safeParseDecimal(line.quantity).error : null;
  const upError = line.unitPrice.trim() ? safeParseDecimal(line.unitPrice).error : null;

  const vatRateParsed = safeParseDecimal(line.vatRate);
  const vatRateError = line.vatRate.trim() ? vatRateParsed.error : null;
  let vatRateOutOfRange = false;
  if (!vatRateError && vatRateParsed.value) {
    try {
      const rv = new Decimal(vatRateParsed.value);
      vatRateOutOfRange = rv.lt(0) || rv.gt(100);
    } catch { /* ignore */ }
  }

  const pageError = parsePageInput(line.sourcePage).error;

  // Mismatch: Qty × UnitPrice ≠ Net (net is explicit) — respects currency tolerance
  let qtyNetMismatch = false;
  if (!netDerived && !netBlank && line.quantity.trim() && line.unitPrice.trim() &&
      !qtyError && !upError && !netError) {
    try {
      const qty = new Decimal(safeParseDecimal(line.quantity).value!);
      const up = new Decimal(safeParseDecimal(line.unitPrice).value!);
      const net = new Decimal(safeParseDecimal(line.netAmount).value!);
      if (mismatchExceedsTolerance(qty.times(up), net, currencyType)) qtyNetMismatch = true;
    } catch { /* ignore */ }
  }

  // Mismatch: Net × VatRate/100 ≠ VatAmt (vat is explicit) — respects currency tolerance
  let vatMismatch = false;
  if (!vatDerived && !vatBlank && line.vatRate.trim() &&
      !vatAmtError && !vatRateError && !vatRateOutOfRange && display.netAmount) {
    try {
      const net = new Decimal(safeParseDecimal(display.netAmount).value!);
      const rate = new Decimal(vatRateParsed.value!);
      const vat = new Decimal(safeParseDecimal(line.vatAmount).value!);
      if (mismatchExceedsTolerance(net.times(rate).dividedBy(100), vat, currencyType)) vatMismatch = true;
    } catch { /* ignore */ }
  }

  // Mismatch: Net + VatAmt ≠ Gross (gross is explicit) — respects currency tolerance
  let grossMismatch = false;
  if (!grossDerived && !grossBlank && !grossError && display.netAmount && display.vatAmount) {
    const netP = safeParseDecimal(display.netAmount);
    const vatP = safeParseDecimal(display.vatAmount);
    if (!netP.error && !vatP.error && netP.value !== null && vatP.value !== null) {
      try {
        const net = new Decimal(netP.value);
        const vat = new Decimal(vatP.value);
        const gross = new Decimal(safeParseDecimal(line.grossAmount).value!);
        if (mismatchExceedsTolerance(net.plus(vat), gross, currencyType)) grossMismatch = true;
      } catch { /* ignore */ }
    }
  }

  return {
    display,
    netDerived, vatDerived, grossDerived,
    netError, vatAmtError, grossError, qtyError, upError,
    vatRateError, vatRateOutOfRange,
    qtyNetMismatch, vatMismatch, grossMismatch,
    pageError,
  };
}

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
  const { t } = useI18n();
  const il = t.invoiceLines;

  if (line.recognitionTreatment !== "Prepaid") return null;
  if (!line.recognitionStartDate || !line.recognitionEndDate) return null;

  const netParsed = safeParseDecimal(line.netAmount);
  if (netParsed.error || !netParsed.value) return null;

  const isForeignCurrency = currency && baseCurrency && currency !== baseCurrency;
  const rateParsed = safeParseDecimal(fxRate ?? "");
  const hasValidFx = !rateParsed.error && !!rateParsed.value;

  // For foreign currency, require valid FX to show base amounts; fall back to 1 for
  // computing origAmount only (rate doesn't affect per-month original amounts)
  const safeRate = hasValidFx ? rateParsed.value! : "1";
  // Show base column only when FX is known and valid
  const showBase = isForeignCurrency && hasValidFx;

  const rows = deriveRecognitionSchedule({
    netAmount: netParsed.value,
    fxRate: safeRate,
    treatment: "Prepaid",
    invoiceDate: invoiceDate || null,
    startDate: line.recognitionStartDate,
    endDate: line.recognitionEndDate,
  });

  if (rows.length === 0) return null;

  const s = rows.length !== 1 ? "s" : "";
  const title = il.recognitionScheduleTitle
    .replace("{count}", String(rows.length))
    .replace("{s}", s);

  return (
    <div style={{ marginTop: 8, padding: "8px 10px", background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 5 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#0369a1", textTransform: "uppercase", marginBottom: 6 }}>
        {title}
      </div>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 11 }}>
        <thead>
          <tr style={{ color: "#64748b" }}>
            <th style={{ textAlign: "left", padding: "2px 6px 2px 0" }}>{il.month}</th>
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
      {isForeignCurrency && !hasValidFx && (
        <div style={{ marginTop: 6, fontSize: 10, color: "#0369a1" }}>
          {il.enterFxForBase.replace("{base}", baseCurrency ?? "")}
        </div>
      )}
    </div>
  );
}

export default function InvoiceLinesEditor({
  lines,
  postingAccounts,
  prepaidAccounts = [],
  invoiceNetAmount,
  invoiceDate,
  invoiceFxRate,
  invoiceCurrency,
  baseCurrency,
  currencyType = "fiat",
  onChange,
}: Props) {
  const { t } = useI18n();
  const il = t.invoiceLines;
  const cm = t.common;

  const displayLines = lines.map(applyAutoCalcToLine);
  const lineAmountSummary = sumInvoiceLineAmounts(displayLines);
  const parsedInvoiceNet = safeParseDecimal(invoiceNetAmount);
  const comparableInvoiceNet = parsedInvoiceNet.error ? null : parsedInvoiceNet.value;
  const amountsMismatch = lines.length > 0
    && lineAmountSummary.invalidLineNumbers.length === 0
    && comparableInvoiceNet !== null
    && !amountsWithinTolerance(lineAmountSummary.sum, comparableInvoiceNet, currencyType);

  function update(index: number, field: keyof EditableInvoiceLine, value: string) {
    onChange(lines.map((line, lineIndex) => lineIndex === index ? { ...line, [field]: value } : line));
  }

  function updateTreatment(index: number, value: "Immediate" | "Prepaid") {
    onChange(lines.map((line, lineIndex) =>
      lineIndex === index
        ? { ...line, recognitionTreatment: value, recognitionStartDate: "", recognitionEndDate: "", prepaidAccountNumber: "" }
        : line
    ));
  }

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em" }}>
          {il.titleWithCount.replace("{count}", String(lines.length))}
        </div>
        <button
          type="button"
          onClick={() => onChange([...lines, emptyEditableInvoiceLine()])}
          style={{ padding: "6px 10px", border: "1px solid #cbd5e1", borderRadius: 6, background: "#fff", cursor: "pointer", fontSize: 12 }}
        >
          {il.addLine}
        </button>
      </div>

      {lines.length === 0 ? (
        <div style={{ padding: 14, border: "1px dashed #cbd5e1", borderRadius: 6, color: "#64748b", fontSize: 13 }}>
          {il.noLines}
        </div>
      ) : (
        <div>
          {lines.map((line, index) => {
            const ld = computeLineDisplay(line, currencyType);
            const displayLine = ld.display;

            return (
              <div
                key={line.id ?? `draft-${index}`}
                className="invoice-line-card"
                style={{ border: "1px solid #e2e8f0", borderRadius: 6, padding: 12, marginBottom: 10, background: "#fff" }}
              >
                {/* Row 1: core fields */}
                <div className="invoice-line-core-grid">
                  <div className="invoice-line-field invoice-line-compact-field invoice-line-number-field">
                    <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 2 }}>{il.lineNum}</div>
                    <input className="invoice-line-control" aria-label={`Line ${index + 1} number`} style={inputStyle} value={line.lineNumber} onChange={(e) => update(index, "lineNumber", e.target.value)} />
                  </div>
                  <div className="invoice-line-field invoice-line-description-field invoice-line-original-description-field">
                    <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 2 }}>{il.origDesc}</div>
                    <textarea className="invoice-line-control" aria-label={`Line ${index + 1} original description`} style={{ ...inputStyle, resize: "vertical" }} value={line.descriptionOriginal} onChange={(e) => update(index, "descriptionOriginal", e.target.value)} />
                  </div>
                  <div className="invoice-line-field invoice-line-description-field invoice-line-english-description-field">
                    <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 2 }}>{il.description}</div>
                    <textarea className="invoice-line-control" aria-label={`Line ${index + 1} English description`} style={{ ...inputStyle, resize: "vertical" }} value={line.description} onChange={(e) => update(index, "description", e.target.value)} />
                  </div>
                  <div className="invoice-line-field invoice-line-compact-field invoice-line-qty-field">
                    <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 2 }}>{il.qty}</div>
                    <input
                      className="invoice-line-control"
                      aria-label={`Line ${index + 1} quantity`}
                      style={ld.qtyError ? errorInputStyle : inputStyle}
                      value={line.quantity}
                      onChange={(e) => update(index, "quantity", e.target.value)}
                    />
                  </div>
                  <div className="invoice-line-field invoice-line-compact-field invoice-line-unit-field">
                    <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 2 }}>{il.unit}</div>
                    <input className="invoice-line-control" aria-label={`Line ${index + 1} unit`} style={inputStyle} value={line.unit} onChange={(e) => update(index, "unit", e.target.value)} />
                  </div>
                  <div className="invoice-line-field invoice-line-compact-field invoice-line-amounts-field">
                    <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 2 }}>{il.unitPrice}</div>
                    <input
                      className="invoice-line-control"
                      aria-label={`Line ${index + 1} unitPrice`}
                      style={ld.upError ? errorInputStyle : inputStyle}
                      value={line.unitPrice}
                      onChange={(e) => update(index, "unitPrice", e.target.value)}
                    />
                  </div>
                  <div className="invoice-line-field invoice-line-compact-field invoice-line-amounts-field">
                    <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 2 }}>{il.netAmount}</div>
                    <input
                      className="invoice-line-control"
                      aria-label={`Line ${index + 1} netAmount`}
                      style={fieldInputStyle(line.netAmount, ld.netDerived, !!ld.netError)}
                      value={ld.netDerived ? stripTrailingZeros(displayLine.netAmount) : line.netAmount}
                      onChange={(e) => update(index, "netAmount", e.target.value)}
                      title={ld.netDerived ? il.autoCalcNet : undefined}
                    />
                  </div>
                  <div className="invoice-line-field invoice-line-compact-field invoice-line-amounts-field">
                    <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 2 }}>{il.vatRate}</div>
                    <input
                      className="invoice-line-control"
                      aria-label={`Line ${index + 1} vatRate`}
                      style={(ld.vatRateError || ld.vatRateOutOfRange) ? errorInputStyle : inputStyle}
                      value={line.vatRate}
                      onChange={(e) => update(index, "vatRate", e.target.value)}
                    />
                  </div>
                  <div className="invoice-line-field invoice-line-compact-field invoice-line-amounts-field">
                    <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 2 }}>{il.vatAmount}</div>
                    <input
                      className="invoice-line-control"
                      aria-label={`Line ${index + 1} vatAmount`}
                      style={fieldInputStyle(line.vatAmount, ld.vatDerived, !!ld.vatAmtError)}
                      value={ld.vatDerived ? stripTrailingZeros(displayLine.vatAmount) : line.vatAmount}
                      onChange={(e) => update(index, "vatAmount", e.target.value)}
                      title={ld.vatDerived ? il.autoCalcVat : undefined}
                    />
                  </div>
                  <div className="invoice-line-field invoice-line-compact-field invoice-line-amounts-field">
                    <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 2 }}>{il.grossAmount}</div>
                    <input
                      className="invoice-line-control"
                      aria-label={`Line ${index + 1} grossAmount`}
                      style={fieldInputStyle(line.grossAmount, ld.grossDerived, !!ld.grossError)}
                      value={ld.grossDerived ? stripTrailingZeros(displayLine.grossAmount) : line.grossAmount}
                      onChange={(e) => update(index, "grossAmount", e.target.value)}
                      title={ld.grossDerived ? il.autoCalcGross : undefined}
                    />
                  </div>
                  <div className="invoice-line-field invoice-line-compact-field invoice-line-page-field">
                    <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 2 }}>{il.page}</div>
                    <input
                      className="invoice-line-control"
                      aria-label={`Line ${index + 1} sourcePage`}
                      style={ld.pageError ? errorInputStyle : inputStyle}
                      value={line.sourcePage}
                      onChange={(e) => update(index, "sourcePage", e.target.value)}
                    />
                    {ld.pageError && (
                      <div style={{ fontSize: 10, color: "#dc2626", marginTop: 2 }}>{ld.pageError}</div>
                    )}
                  </div>
                  <div className="invoice-line-delete-field" style={{ paddingTop: 18 }}>
                    <button
                      type="button"
                      onClick={() => onChange(lines.filter((_, lineIndex) => lineIndex !== index))}
                      style={{ padding: "6px 8px", border: "1px solid #fecaca", borderRadius: 5, background: "#fff", color: "#dc2626", cursor: "pointer", fontSize: 11 }}
                    >
                      {il.del}
                    </button>
                  </div>
                </div>

                {/* Per-line validation banners */}
                {ld.vatRateOutOfRange && (
                  <div style={{ marginTop: 6, padding: "5px 8px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 4, color: "#dc2626", fontSize: 11 }}>
                    {il.vatOutOfRange}
                  </div>
                )}
                {ld.qtyNetMismatch && (
                  <div style={{ marginTop: 6, padding: "5px 8px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 4, color: "#92400e", fontSize: 11 }}>
                    {il.qtyNetMismatch}
                  </div>
                )}
                {ld.vatMismatch && (
                  <div style={{ marginTop: 6, padding: "5px 8px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 4, color: "#92400e", fontSize: 11 }}>
                    {il.vatMismatch}
                  </div>
                )}
                {ld.grossMismatch && (
                  <div style={{ marginTop: 6, padding: "5px 8px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 4, color: "#92400e", fontSize: 11 }}>
                    {il.grossMismatch}
                  </div>
                )}

                {/* Row 2: recognition + accounting fields */}
                <div className="invoice-line-recognition-grid">
                  <div className="invoice-line-treatment-field">
                    <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 2 }}>{il.treatment}</div>
                    <select
                      aria-label={`Line ${index + 1} recognition treatment`}
                      className="invoice-line-control"
                      style={selectStyle}
                      value={line.recognitionTreatment}
                      onChange={(e) => updateTreatment(index, e.target.value as "Immediate" | "Prepaid")}
                    >
                      <option value="Immediate">{il.immediate}</option>
                      <option value="Prepaid">{il.prepaid}</option>
                    </select>
                  </div>

                  {line.recognitionTreatment === "Prepaid" && (
                    <>
                      <div className="invoice-line-date-field">
                        <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 2 }}>{il.recognitionStart}</div>
                        <input
                          type="date"
                          aria-label={`Line ${index + 1} recognition start date`}
                          className="invoice-line-control"
                          style={inputStyle}
                          value={line.recognitionStartDate}
                          onChange={(e) => update(index, "recognitionStartDate", e.target.value)}
                        />
                      </div>
                      <div className="invoice-line-date-field">
                        <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 2 }}>{il.recognitionEnd}</div>
                        <input
                          type="date"
                          aria-label={`Line ${index + 1} recognition end date`}
                          className="invoice-line-control"
                          style={inputStyle}
                          value={line.recognitionEndDate}
                          onChange={(e) => update(index, "recognitionEndDate", e.target.value)}
                          min={line.recognitionStartDate || undefined}
                        />
                      </div>
                    </>
                  )}

                  <div className="invoice-line-account-field">
                    <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 2 }}>{il.expenseAccount}</div>
                    <select
                      aria-label={`Line ${index + 1} accounting account number`}
                      className="invoice-line-control"
                      style={selectStyle}
                      value={line.accountingAccountNumber}
                      onChange={(e) => update(index, "accountingAccountNumber", e.target.value)}
                    >
                      <option value="">{cm.selectNone}</option>
                      {postingAccounts.map((account) => (
                        <option key={account.code} value={account.code}>
                          {account.code} — {account.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {line.recognitionTreatment === "Prepaid" && (
                    <div className="invoice-line-account-field">
                      <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 2 }}>{il.prepaidAccount}</div>
                      <select
                        aria-label={`Line ${index + 1} prepaid account number`}
                        className="invoice-line-control"
                        style={selectStyle}
                        value={line.prepaidAccountNumber}
                        onChange={(e) => update(index, "prepaidAccountNumber", e.target.value)}
                      >
                        <option value="">{cm.selectNone}</option>
                        {prepaidAccounts.map((account) => (
                          <option key={account.code} value={account.code}>
                            {account.code} — {account.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                {/* Prepaid date validation hints */}
                {line.recognitionTreatment === "Prepaid" && line.recognitionStartDate && line.recognitionEndDate && line.recognitionEndDate < line.recognitionStartDate && (
                  <div style={{ marginTop: 6, padding: "5px 8px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 4, color: "#dc2626", fontSize: 11 }}>
                    {il.endBeforeStart}
                  </div>
                )}
                {line.recognitionTreatment === "Prepaid" && (!line.recognitionStartDate || !line.recognitionEndDate) && (
                  <div style={{ marginTop: 6, padding: "5px 8px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 4, color: "#92400e", fontSize: 11 }}>
                    {il.datesRequired}
                  </div>
                )}
                {line.recognitionTreatment === "Prepaid" && (!line.accountingAccountNumber || !line.prepaidAccountNumber) && (
                  <div style={{ marginTop: 6, padding: "5px 8px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 4, color: "#92400e", fontSize: 11 }}>
                    {il.accountsRequired}
                  </div>
                )}

                {/* Monthly recognition preview */}
                <RecognitionPreview
                  line={displayLine}
                  invoiceDate={invoiceDate}
                  fxRate={invoiceFxRate}
                  currency={invoiceCurrency}
                  baseCurrency={baseCurrency}
                />
              </div>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: 12, padding: 12, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 13 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
          <span style={{ color: "#475569" }}>{il.sumOfLines}</span>
          <strong style={{ color: "#1e293b" }}>{lineAmountSummary.sum}</strong>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, marginTop: 5 }}>
          <span style={{ color: "#475569" }}>{il.invoiceNet}</span>
          <strong style={{ color: "#1e293b" }}>{(comparableInvoiceNet ?? invoiceNetAmount) || cm.none}</strong>
        </div>
        {lineAmountSummary.invalidLineNumbers.length > 0 && (
          <div style={{ marginTop: 9, padding: "8px 10px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 5, color: "#b91c1c" }}>
            {il.enterValidLine
              .replace("{s}", lineAmountSummary.invalidLineNumbers.length === 1 ? "" : "s")
              .replace("{lines}", lineAmountSummary.invalidLineNumbers.join(", "))}
          </div>
        )}
        {amountsMismatch && (
          <div style={{ marginTop: 9, padding: "8px 10px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 5, color: "#92400e" }}>
            {il.lineSumMismatch}
          </div>
        )}
      </div>
    </div>
  );
}
