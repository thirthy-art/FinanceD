import type { AiInvoiceExtraction } from "./ai-extraction";
import { Decimal } from "./decimal";
import { FIAT_TOLERANCE, safeParseDecimal, toDecimal } from "./invoice-validation";

type AiInvoiceLine = AiInvoiceExtraction["lines"][number];

export interface AiLineCoherenceWarning {
  lineIndex: number | null;
  message: string;
}

export interface AiLineCoherenceResult {
  previewLines: AiInvoiceLine[];
  applicationLines: AiInvoiceLine[];
  warnings: AiLineCoherenceWarning[];
  sourceAmountMeaning: "gross" | "net" | "unresolved" | "unavailable";
}

function asDecimal(value: string | null): Decimal | null {
  const parsed = safeParseDecimal(value);
  if (parsed.error || parsed.value === null) return null;
  return toDecimal(parsed.value);
}

function amountsReconcile(
  left: Decimal,
  right: Decimal,
  currencyType: "fiat" | "crypto",
): boolean {
  const difference = left.minus(right).abs();
  return currencyType === "crypto"
    ? difference.isZero()
    : difference.lessThanOrEqualTo(new Decimal(FIAT_TOLERANCE));
}

function clearApplicationNumerics(line: AiInvoiceLine): AiInvoiceLine {
  return {
    ...line,
    quantity: null,
    unitPrice: null,
    netAmount: null,
    vatRate: null,
    vatAmount: null,
    grossAmount: null,
  };
}

export function cohereAiInvoiceLines(
  lines: AiInvoiceLine[],
  {
    invoiceNetAmount,
    invoiceGrossAmount,
    currencyType = "fiat",
  }: {
    invoiceNetAmount: string | null;
    invoiceGrossAmount: string | null;
    currencyType?: "fiat" | "crypto";
  },
): AiLineCoherenceResult {
  const warnings: AiLineCoherenceWarning[] = [];
  const suspiciousRows = new Set<number>();

  lines.forEach((line, index) => {
    const quantity = asDecimal(line.quantity);
    const unitPrice = asDecimal(line.unitPrice);
    const extendedPrice = asDecimal(line.extendedPrice);
    if (quantity === null || unitPrice === null || extendedPrice === null) return;

    if (!amountsReconcile(quantity.times(unitPrice), extendedPrice, currencyType)) {
      suspiciousRows.add(index);
      warnings.push({
        lineIndex: index,
        message: `Row ${line.lineNumber ?? String(index + 1)}: quantity times unit price does not match the explicit Price. Numerical values were not applied.`,
      });
    }
  });

  const sourceAmounts = lines.map((line) => asDecimal(line.sourceAmount));
  const hasAnySourceAmount = sourceAmounts.some((amount) => amount !== null);
  const hasCompleteSourceAmounts = lines.length > 0 && sourceAmounts.every((amount) => amount !== null);
  let sourceAmountMeaning: AiLineCoherenceResult["sourceAmountMeaning"] = "unavailable";

  if (hasCompleteSourceAmounts) {
    const sourceAmountTotal = sourceAmounts.reduce((total, amount) => total.plus(amount as Decimal), new Decimal("0"));
    const invoiceGross = asDecimal(invoiceGrossAmount);
    const invoiceNet = asDecimal(invoiceNetAmount);
    if (invoiceGross && amountsReconcile(sourceAmountTotal, invoiceGross, currencyType)) {
      sourceAmountMeaning = "gross";
    } else if (invoiceNet && amountsReconcile(sourceAmountTotal, invoiceNet, currencyType)) {
      sourceAmountMeaning = "net";
    } else {
      sourceAmountMeaning = "unresolved";
      warnings.push({
        lineIndex: null,
        message: "Source Amount values do not reconcile with the invoice net or gross total, so they were not mapped to line totals.",
      });
    }
  } else if (hasAnySourceAmount) {
    sourceAmountMeaning = "unresolved";
    warnings.push({
      lineIndex: null,
      message: "Source Amount values are incomplete, so they were not mapped to line totals.",
    });
  }

  const applicationLines = lines.map((line, index) => {
    if (suspiciousRows.has(index)) return clearApplicationNumerics(line);

    if (line.sourceAmount !== null) {
      if (sourceAmountMeaning === "gross") {
        return { ...line, netAmount: null, vatAmount: null, grossAmount: line.sourceAmount };
      }
      if (sourceAmountMeaning === "net") {
        return { ...line, netAmount: line.sourceAmount, vatAmount: null, grossAmount: null };
      }
      if (sourceAmountMeaning === "unresolved") {
        return { ...line, netAmount: null, vatAmount: null, grossAmount: null };
      }
    }
    return { ...line };
  });

  return {
    previewLines: lines.map((line) => ({ ...line })),
    applicationLines,
    warnings,
    sourceAmountMeaning,
  };
}
