import { Decimal, BASE_ROUNDING } from "./decimal";

export const FIAT_TOLERANCE = "0.01";
const BASE_SCALE = 4;
const AMOUNT_MAX_INT_DIGITS = 20;
const AMOUNT_MAX_FRAC_DIGITS = 18;
const RATE_MAX_INT_DIGITS = 20;
const RATE_MAX_FRAC_DIGITS = 18;
const BASE_MAX_INT_DIGITS = 14;
const BASE_MAX_FRAC_DIGITS = 4;

// Allowed leading/trailing currency symbols stripped before numeric parsing.
const CURRENCY_SYMBOL_RE = /^[\$€£¥₹₿]+|[\$€£¥₹₿]+$/g;

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

/**
 * Attempt to normalize a raw user string into a canonical decimal string.
 * Returns the normalized string, or null if the input is blank/absent.
 * Throws a descriptive Error if the input is present but malformed.
 */
export function parseDecimalInput(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  // Strip only known currency symbols, not arbitrary characters
  const stripped = trimmed.replace(CURRENCY_SYMBOL_RE, "").trim();
  if (stripped === "") {
    throw new Error(`Invalid decimal value: "${trimmed}"`);
  }

  // After symbol stripping, every remaining character must be digit, period,
  // comma, or leading minus. Anything else is rejected outright.
  if (/[^\d.,\-]/.test(stripped)) {
    throw new Error(`Invalid decimal value: "${trimmed}"`);
  }

  // Minus must appear only as the very first character
  if (stripped.lastIndexOf("-") > 0) {
    throw new Error(`Invalid decimal value: "${trimmed}"`);
  }

  let cleaned = stripped;
  if (cleaned === "-" || cleaned === "." || cleaned === "," || cleaned === "-.") {
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
      // "1.234,56" → European: periods are thousands, comma is decimal
      const parts = cleaned.split(",");
      if (parts.length !== 2) {
        throw new Error(`Invalid decimal value: "${trimmed}"`);
      }
      const intPart = parts[0];
      // Validate thousands grouping: groups of exactly 3 digits after first group
      const groups = intPart.split(".");
      for (let i = 1; i < groups.length; i++) {
        if (groups[i].length !== 3) {
          throw new Error(`Invalid decimal value: "${trimmed}"`);
        }
      }
      cleaned = intPart.replace(/\./g, "") + "." + parts[1];
    } else {
      // "1,234.56" → US/UK: commas are thousands, period is decimal
      const parts = cleaned.split(".");
      if (parts.length !== 2) {
        throw new Error(`Invalid decimal value: "${trimmed}"`);
      }
      const intPart = parts[0];
      // Validate thousands grouping: groups of exactly 3 digits after first group
      const groups = intPart.split(",");
      for (let i = 1; i < groups.length; i++) {
        if (groups[i].length !== 3) {
          throw new Error(`Invalid decimal value: "${trimmed}"`);
        }
      }
      cleaned = intPart.replace(/,/g, "") + "." + parts[1];
    }
  } else if (hasComma && !hasPeriod) {
    const parts = cleaned.split(",");
    if (parts.length === 2 && parts[1].length <= 2) {
      // "1234,56" → European decimal (1-2 digits after comma)
      cleaned = parts[0] + "." + parts[1];
    } else if (parts.length === 2 && parts[1].length > 3) {
      // "1234,5678..." → comma as decimal (crypto-length fractional)
      cleaned = parts[0] + "." + parts[1];
    } else if (parts.length === 2 && parts[1].length === 3) {
      // "1,234" — ambiguous
      throw new Error(
        `Ambiguous value: "${trimmed}". Use "1234" or "1234.00" to clarify.`
      );
    } else {
      // Multiple commas: validate as thousands separators (each group must be 3 digits)
      for (let i = 1; i < parts.length; i++) {
        if (parts[i].length !== 3) {
          throw new Error(`Invalid decimal value: "${trimmed}"`);
        }
      }
      cleaned = parts.join("");
    }
  } else if (hasPeriod && !hasComma) {
    // Multiple periods are invalid
    const dotParts = cleaned.split(".");
    if (dotParts.length > 2) {
      throw new Error(`Invalid decimal value: "${trimmed}"`);
    }
  }

  if (negative) cleaned = "-" + cleaned;

  try {
    const dec = new Decimal(cleaned);
    return dec.toFixed();
  } catch {
    throw new Error(`Invalid decimal value: "${trimmed}"`);
  }
}

/**
 * Non-throwing version for client-side rendering. Returns { value, error }.
 */
export function safeParseDecimal(raw: string | null | undefined): { value: string | null; error: string | null } {
  try {
    return { value: parseDecimalInput(raw), error: null };
  } catch (e) {
    return { value: null, error: (e as Error).message };
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

/**
 * Non-throwing mismatch check for client-side use.
 * Returns false (no mismatch) if any input is unparseable.
 */
export function safeIsAmountMismatch(
  net: string | null | undefined,
  vat: string | null | undefined,
  gross: string | null | undefined,
  currencyType: "fiat" | "crypto" = "fiat"
): boolean {
  try {
    return isAmountMismatch(net, vat, gross, currencyType);
  } catch {
    return false;
  }
}

/**
 * Non-throwing base amount calculation for client-side preview.
 */
export function safeCalculateBaseAmount(
  originalAmount: string | null | undefined,
  fxRateToBase: string | null | undefined
): string | null {
  try {
    return calculateBaseAmount(originalAmount, fxRateToBase);
  } catch {
    return null;
  }
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
 * Enforces numeric(38,18) bounds. Returns the canonical string or throws.
 */
export function validatePositiveRate(raw: string): string {
  const canonical = parseDecimalInput(raw);
  if (!canonical) throw new Error("FX rate is required");
  const dec = new Decimal(canonical);
  if (dec.isNegative() || dec.isZero()) {
    throw new Error("FX rate must be greater than zero");
  }
  const parts = canonical.replace("-", "").split(".");
  const intDigits = parts[0].replace(/^0+/, "").length || 1;
  const fracDigits = parts[1]?.length ?? 0;
  if (intDigits > RATE_MAX_INT_DIGITS || fracDigits > RATE_MAX_FRAC_DIGITS) {
    throw new Error("FX rate exceeds the supported precision (max 20 integer digits, 18 decimal places)");
  }
  return canonical;
}

/**
 * Validate that a string is a valid non-negative decimal for monetary amounts.
 * Enforces numeric(38,18) bounds. Returns the canonical string or throws.
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
  if (intDigits > AMOUNT_MAX_INT_DIGITS || fracDigits > AMOUNT_MAX_FRAC_DIGITS) {
    throw new Error(`${fieldName} exceeds the supported scale (max 18 decimal places)`);
  }
  return canonical;
}

/**
 * Check whether a VAT rate string is valid (0–100 inclusive, or blank).
 * Returns true for blank/null (blank is allowed on drafts).
 */
export function isVatRateValid(raw: string | null | undefined): boolean {
  if (!raw || !raw.trim()) return true;
  const parsed = safeParseDecimal(raw);
  if (parsed.error || parsed.value === null) return false;
  const dec = new Decimal(parsed.value);
  return dec.gte(0) && dec.lte(100);
}

/**
 * Validate that a computed base amount fits numeric(18,4).
 * Returns the value or throws if it would overflow the DB column.
 */
export function validateBaseAmount(value: string | null, fieldName: string): string | null {
  if (value === null) return null;
  const parts = value.replace("-", "").split(".");
  const intDigits = parts[0].replace(/^0+/, "").length || 1;
  const fracDigits = parts[1]?.length ?? 0;
  if (intDigits > BASE_MAX_INT_DIGITS || fracDigits > BASE_MAX_FRAC_DIGITS) {
    throw new Error(`${fieldName} exceeds the base-currency column capacity (numeric 18,4). The combination of amount and FX rate is too large.`);
  }
  return value;
}
