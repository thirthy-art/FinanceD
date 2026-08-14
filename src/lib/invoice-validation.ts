import { Decimal, BASE_ROUNDING } from "./decimal";

export const FIAT_TOLERANCE = "0.01";
const BASE_SCALE = 4;

// ── Decimal separator rules ──────────────────────────────────────────────────
//
// Supported formats:
//   "1234.56"      → 1234.56   (period decimal)
//   "1,234.56"     → 1234.56   (US/UK thousands + period decimal)
//   "1234,56"      → 1234.56   (European comma decimal, ≤2 digits after comma)
//   "1.234,56"     → 1234.56   (European thousands + comma decimal)
//   Crypto values with up to 18 decimal places using "." or ","
//
// Ambiguous cases are rejected (e.g. "1,234" could be 1234 or 1.234).
// The disambiguation rule: a trailing comma group with 1–2 digits is a decimal
// separator; with 3+ digits it is treated as a thousands separator only when
// the string also contains periods as thousands separators or no periods at all
// AND is followed by exactly 3 digits.

/**
 * Attempt to normalize a raw user string into a canonical decimal string.
 * Returns the normalized string, or null if the input is blank/absent.
 * Throws a descriptive Error if the input is present but malformed.
 */
export function parseDecimalInput(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  let cleaned = trimmed.replace(/[^\d.,\-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === "." || cleaned === ",") {
    throw new Error(`Invalid decimal value: "${trimmed}"`);
  }

  const negative = cleaned.startsWith("-");
  if (negative) cleaned = cleaned.slice(1);

  const hasPeriod = cleaned.includes(".");
  const hasComma = cleaned.includes(",");

  if (hasPeriod && hasComma) {
    const lastPeriod = cleaned.lastIndexOf(".");
    const lastComma = cleaned.lastIndexOf(",");
    if (lastComma > lastPeriod) {
      // "1.234,56" → European format: periods are thousands, comma is decimal
      cleaned = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
      // "1,234.56" → US/UK format: commas are thousands, period is decimal
      cleaned = cleaned.replace(/,/g, "");
    }
  } else if (hasComma && !hasPeriod) {
    const parts = cleaned.split(",");
    if (parts.length === 2 && parts[1].length <= 2) {
      // "1234,56" → European decimal (1-2 digits after comma)
      cleaned = cleaned.replace(",", ".");
    } else if (parts.length === 2 && parts[1].length > 3) {
      // "1234,5678..." → comma as decimal (crypto-length fractional)
      cleaned = cleaned.replace(",", ".");
    } else if (parts.length === 2 && parts[1].length === 3) {
      // "1,234" — ambiguous: could be 1234 or 1.234
      throw new Error(
        `Ambiguous value: "${trimmed}". Use "1234" or "1234.00" to clarify.`
      );
    } else {
      // "1,234,567" — multiple commas are thousands separators
      cleaned = cleaned.replace(/,/g, "");
    }
  }
  // hasPeriod && !hasComma: period is decimal, no transformation needed

  if (negative) cleaned = "-" + cleaned;

  try {
    const dec = new Decimal(cleaned);
    return dec.toFixed();
  } catch {
    throw new Error(`Invalid decimal value: "${trimmed}"`);
  }
}

/**
 * Legacy helper: clean an amount string for display/validation purposes.
 * Returns "0" for absent values, throws on malformed present values.
 */
export function cleanAmount(raw: string | null | undefined): string {
  const result = parseDecimalInput(raw);
  return result ?? "0";
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
  return amount.times(rate).toFixed(BASE_SCALE, BASE_ROUNDING);
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

/**
 * Validate that a string is a valid positive decimal suitable for fxRateToBase.
 * Returns the canonical string or throws.
 */
export function validatePositiveRate(raw: string): string {
  const canonical = parseDecimalInput(raw);
  if (!canonical) throw new Error("FX rate is required");
  const dec = new Decimal(canonical);
  if (dec.isNegative() || dec.isZero()) {
    throw new Error("FX rate must be greater than zero");
  }
  return canonical;
}

/**
 * Validate that a string is a valid non-negative decimal for monetary amounts.
 * Returns the canonical string or throws.
 */
export function validateAmount(raw: string, fieldName: string): string {
  const canonical = parseDecimalInput(raw);
  if (!canonical) throw new Error(`${fieldName} is required`);
  const dec = new Decimal(canonical);
  if (dec.isNegative()) {
    throw new Error(`${fieldName} must not be negative`);
  }
  const parts = canonical.replace("-", "").split(".");
  const intDigits = parts[0].replace(/^0+/, "").length || 1;
  const fracDigits = parts[1]?.length ?? 0;
  if (intDigits > 20 || fracDigits > 18) {
    throw new Error(`${fieldName} exceeds the supported scale (max 18 decimal places)`);
  }
  return canonical;
}
