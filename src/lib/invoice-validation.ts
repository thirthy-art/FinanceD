import { Decimal } from "./decimal";

export const FIAT_TOLERANCE = "0.01";
const BASE_SCALE = 4;

export function cleanAmount(raw: string | null | undefined): string {
  if (!raw || !raw.trim()) return "0";
  const cleaned = raw
    .replace(/[^\d.,\-]/g, "")
    .replace(/,(\d{1,2})$/, ".$1")
    .replace(/,/g, "");
  if (!cleaned || cleaned === "-" || cleaned === ".") return "0";
  try {
    new Decimal(cleaned);
    return cleaned;
  } catch {
    return "0";
  }
}

export function toDecimal(raw: string | null | undefined): Decimal {
  return new Decimal(cleanAmount(raw));
}

export function isAmountMismatch(
  net: string | null | undefined,
  vat: string | null | undefined,
  gross: string | null | undefined,
  currencyType: "fiat" | "crypto" = "fiat"
): boolean {
  const netDec = toDecimal(net);
  const vatDec = toDecimal(vat);
  const grossDec = toDecimal(gross);

  if (grossDec.isZero() || netDec.isZero()) return false;

  const diff = netDec.plus(vatDec).minus(grossDec).abs();

  if (currencyType === "crypto") {
    return !diff.isZero();
  }
  return diff.greaterThan(FIAT_TOLERANCE);
}

export function calculateBaseAmount(
  originalAmount: string | null | undefined,
  fxRateToBase: string | null | undefined
): string | null {
  if (!originalAmount || !fxRateToBase) return null;
  const amount = toDecimal(originalAmount);
  const rate = toDecimal(fxRateToBase);
  if (rate.isZero()) return null;
  return amount.times(rate).toFixed(BASE_SCALE, Decimal.ROUND_HALF_EVEN);
}

export function decimalAdd(
  a: string | null | undefined,
  b: string | null | undefined
): string {
  return toDecimal(a).plus(toDecimal(b)).toFixed();
}

export function formatDisplayAmount(
  value: string | null | undefined,
  currencyType: "fiat" | "crypto" = "fiat"
): string {
  if (!value) return "";
  const dec = toDecimal(value);
  if (currencyType === "crypto") {
    if (dec.isZero()) return "0";
    const full = dec.toFixed();
    if (!full.includes(".")) return full;
    return full.replace(/0+$/, "").replace(/\.$/, "");
  }
  return dec.toFixed(2);
}
