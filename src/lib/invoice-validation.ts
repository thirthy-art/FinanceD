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
