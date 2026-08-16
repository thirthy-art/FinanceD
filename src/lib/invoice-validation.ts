// Arithmetic tolerance for net + VAT vs gross comparison, expressed in cents.
// Invoices often carry per-line rounding to 2 decimal places; a 1-cent
// difference is considered acceptable and must not block manual review.
// Anything beyond 1 cent is flagged as a discrepancy requiring user attention.
//
// Comparison is done in integer cents to avoid floating-point representation
// errors (e.g. 100 + 20 - 120.01 evaluates to -0.01000…5 in IEEE 754).
export const AMOUNT_TOLERANCE = 0.01;
const TOLERANCE_CENTS = 1; // Math.round(AMOUNT_TOLERANCE * 100)

/**
 * Returns true when the stored gross amount is inconsistent with net + VAT
 * beyond the acceptable rounding tolerance (1 cent).
 *
 * Only active when all three amounts are positive — partial entries (user
 * typing in progress) are not flagged.
 */
export function isAmountMismatch(
  net: number,
  vat: number,
  gross: number
): boolean {
  if (gross <= 0 || net <= 0) return false;
  // Convert to integer cents before comparing to avoid IEEE 754 drift.
  const netCents = Math.round(net * 100);
  const vatCents = Math.round(vat * 100);
  const grossCents = Math.round(gross * 100);
  return Math.abs(netCents + vatCents - grossCents) > TOLERANCE_CENTS;
}

/** Parse a locale-tolerant decimal string ("1,200.50" or "1200,50") to float. */
export function parseAmount(raw: string | null | undefined): number {
  if (!raw) return 0;
  // Remove thousand separators then normalise decimal comma
  const cleaned = raw.replace(/[^\d.,\-]/g, "").replace(/,(\d{2})$/, ".$1").replace(/,/g, "");
  return parseFloat(cleaned) || 0;
}

/**
 * Parse a decimal string safely — returns null for empty/invalid input,
 * never throws. Accepts comma or dot decimal separators.
 */
export function parseSafeDecimal(s: string | null | undefined): number | null {
  if (!s || !s.trim()) return null;
  const cleaned = s.replace(/[^\d.,\-]/g, "").replace(/,(\d{2})$/, ".$1").replace(/,/g, "");
  const n = parseFloat(cleaned);
  if (!isFinite(n) || isNaN(n)) return null;
  return n;
}

/** Returns true iff the string is a valid decimal (parseable, finite, not NaN). */
export function isValidDecimalString(s: string | null | undefined): boolean {
  if (!s || !s.trim()) return false;
  return parseSafeDecimal(s) !== null;
}

/**
 * Multiply two decimal strings, rounding to 2dp. Returns null if either
 * input is invalid.
 */
export function multiplyToFixed2(
  a: string | null | undefined,
  b: string | null | undefined
): string | null {
  const av = parseSafeDecimal(a);
  const bv = parseSafeDecimal(b);
  if (av === null || bv === null) return null;
  return (Math.round(av * bv * 100) / 100).toFixed(2);
}

/**
 * Compute VAT amount: net × rate / 100, rounded to 2dp.
 * Rate is a percentage value (e.g. 19 means 19%).
 */
export function computeVatAmount(
  net: string | null | undefined,
  rate: string | null | undefined
): string | null {
  const netV = parseSafeDecimal(net);
  const rateV = parseSafeDecimal(rate);
  if (netV === null || rateV === null) return null;
  return (Math.round(netV * (rateV / 100) * 100) / 100).toFixed(2);
}

/**
 * Compute gross: net + vat, rounded to 2dp.
 */
export function computeGross(
  net: string | null | undefined,
  vat: string | null | undefined
): string | null {
  const netV = parseSafeDecimal(net);
  const vatV = parseSafeDecimal(vat);
  if (netV === null || vatV === null) return null;
  return (Math.round((netV + vatV) * 100) / 100).toFixed(2);
}

/**
 * Validate VAT rate: must be between 0 and 100 (inclusive) when present.
 * Blank is allowed for draft lines.
 */
export function isVatRateValid(rate: string | null | undefined): boolean {
  if (!rate || !rate.trim()) return true; // blank is ok
  const v = parseSafeDecimal(rate);
  if (v === null) return false;
  return v >= 0 && v <= 100;
}

/**
 * Check whether two numeric string amounts materially disagree (beyond
 * the 1-cent tolerance), using the same cent-integer approach as isAmountMismatch.
 * Returns false if either value is missing/invalid (no warning for partial entry).
 */
export function decimalStringsMismatch(
  expected: string | null | undefined,
  actual: string | null | undefined
): boolean {
  const e = parseSafeDecimal(expected);
  const a = parseSafeDecimal(actual);
  if (e === null || a === null) return false;
  if (e <= 0 && a <= 0) return false;
  const eCents = Math.round(e * 100);
  const aCents = Math.round(a * 100);
  return Math.abs(eCents - aCents) > TOLERANCE_CENTS;
}
