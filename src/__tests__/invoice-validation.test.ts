import { describe, it, expect } from "vitest";
import {
  isAmountMismatch,
  cleanAmount,
  toDecimal,
  calculateBaseAmount,
  formatDisplayAmount,
  decimalAdd,
  parseDecimalInput,
  validatePositiveRate,
  validateAmount,
  validateBaseAmount,
  safeParseDecimal,
  safeIsAmountMismatch,
  safeCalculateBaseAmount,
  isVatRateValid,
  FIAT_TOLERANCE,
} from "../lib/invoice-validation";

// ── parseDecimalInput ────────────────────────────────────────────────────────

describe("parseDecimalInput", () => {
  it("returns null for null/undefined/empty/whitespace", () => {
    expect(parseDecimalInput(null)).toBeNull();
    expect(parseDecimalInput(undefined)).toBeNull();
    expect(parseDecimalInput("")).toBeNull();
    expect(parseDecimalInput("   ")).toBeNull();
  });

  it("normalizes '1234.56' (period decimal)", () => {
    expect(parseDecimalInput("1234.56")).toBe("1234.56");
  });

  it("normalizes '1,234.56' (US/UK thousands + period)", () => {
    expect(parseDecimalInput("1,234.56")).toBe("1234.56");
  });

  it("normalizes '1234,56' (European comma decimal, <=2 frac digits)", () => {
    expect(parseDecimalInput("1234,56")).toBe("1234.56");
  });

  it("normalizes '1.234,56' (European thousands + comma decimal)", () => {
    expect(parseDecimalInput("1.234,56")).toBe("1234.56");
  });

  it("handles crypto-length comma decimal '1234,567890123456789012345678'", () => {
    expect(parseDecimalInput("1234,567890123456789012345678")).toBe("1234.567890123456789012345678");
  });

  it("handles multiple commas as thousands separators '1,234,567'", () => {
    expect(parseDecimalInput("1,234,567")).toBe("1234567");
  });

  it("rejects ambiguous '1,234' (3 digits after single comma)", () => {
    expect(() => parseDecimalInput("1,234")).toThrow(/[Aa]mbiguous/);
  });

  it("throws on malformed input", () => {
    expect(() => parseDecimalInput("abc")).toThrow(/[Ii]nvalid/);
    expect(() => parseDecimalInput("...")).toThrow(/[Ii]nvalid/);
    expect(() => parseDecimalInput("$")).toThrow(/[Ii]nvalid/);
  });

  it("strips only known currency symbols", () => {
    expect(parseDecimalInput("$1200.00")).toBe("1200");
    expect(parseDecimalInput("€500")).toBe("500");
    expect(parseDecimalInput("£99.99")).toBe("99.99");
    expect(parseDecimalInput("¥1000")).toBe("1000");
  });

  it("rejects arbitrary text mixed with digits", () => {
    expect(() => parseDecimalInput("abc123")).toThrow(/[Ii]nvalid/);
    expect(() => parseDecimalInput("12abc")).toThrow(/[Ii]nvalid/);
    expect(() => parseDecimalInput("1a2b3c")).toThrow(/[Ii]nvalid/);
    expect(() => parseDecimalInput("hello")).toThrow(/[Ii]nvalid/);
  });

  it("rejects malformed thousands grouping", () => {
    expect(() => parseDecimalInput("12,34,567")).toThrow(/[Ii]nvalid/);
    expect(() => parseDecimalInput("1,23.45")).toThrow(/[Ii]nvalid/);
    expect(() => parseDecimalInput("1.23,45")).toThrow(/[Ii]nvalid/);
  });

  it("rejects misplaced signs and separators", () => {
    expect(() => parseDecimalInput("1-2")).toThrow(/[Ii]nvalid/);
    expect(() => parseDecimalInput("12..34")).toThrow(/[Ii]nvalid/);
    expect(() => parseDecimalInput("-.")).toThrow(/[Ii]nvalid/);
  });

  it("preserves 18-decimal crypto value exactly", () => {
    const crypto = "0.000000000000000001";
    expect(parseDecimalInput(crypto)).toBe("0.000000000000000001");
  });

  it("preserves values with >15 significant digits", () => {
    const precise = "123456789012345678.123456789012345678";
    expect(parseDecimalInput(precise)).toBe("123456789012345678.123456789012345678");
  });

  it("handles negative values", () => {
    expect(parseDecimalInput("-500.25")).toBe("-500.25");
  });
});

// ── safeParseDecimal ────────────────────────────────────────────────────────

describe("safeParseDecimal", () => {
  it("returns value for valid input", () => {
    expect(safeParseDecimal("1234.56")).toEqual({ value: "1234.56", error: null });
  });

  it("returns null value for blank input", () => {
    expect(safeParseDecimal("")).toEqual({ value: null, error: null });
    expect(safeParseDecimal(null)).toEqual({ value: null, error: null });
  });

  it("returns error for malformed input without throwing", () => {
    const result = safeParseDecimal("abc");
    expect(result.value).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it("returns error for ambiguous input without throwing", () => {
    const result = safeParseDecimal("1,234");
    expect(result.value).toBeNull();
    expect(result.error).toMatch(/[Aa]mbiguous/);
  });

  it("returns error for partially numeric input", () => {
    const result = safeParseDecimal("abc123");
    expect(result.value).toBeNull();
    expect(result.error).toBeTruthy();
  });
});

// ── safeIsAmountMismatch ────────────────────────────────────────────────────

describe("safeIsAmountMismatch", () => {
  it("returns false (no mismatch) for valid matching amounts", () => {
    expect(safeIsAmountMismatch("100", "20", "120", "fiat")).toBe(false);
  });

  it("returns true for valid mismatched amounts", () => {
    expect(safeIsAmountMismatch("100", "20", "200", "fiat")).toBe(true);
  });

  it("returns false when input is malformed", () => {
    expect(safeIsAmountMismatch("abc", "20", "120", "fiat")).toBe(false);
    expect(safeIsAmountMismatch("100", "xyz", "120", "fiat")).toBe(false);
  });
});

// ── safeCalculateBaseAmount ─────────────────────────────────────────────────

describe("safeCalculateBaseAmount", () => {
  it("calculates correctly for valid input", () => {
    expect(safeCalculateBaseAmount("100", "1.5")).toBe("150.0000");
  });

  it("returns null for malformed amount", () => {
    expect(safeCalculateBaseAmount("abc", "1.5")).toBeNull();
  });

  it("returns null for malformed rate", () => {
    expect(safeCalculateBaseAmount("100", "xyz")).toBeNull();
  });
});

// ── cleanAmount ──────────────────────────────────────────────────────────────

describe("cleanAmount", () => {
  it("returns '0' for null/undefined/empty", () => {
    expect(cleanAmount(null)).toBe("0");
    expect(cleanAmount(undefined)).toBe("0");
    expect(cleanAmount("")).toBe("0");
    expect(cleanAmount("   ")).toBe("0");
  });

  it("strips currency symbols", () => {
    expect(cleanAmount("$1200.00")).toBe("1200");
    expect(cleanAmount("€500")).toBe("500");
  });

  it("handles thousand separators", () => {
    expect(cleanAmount("1,200.50")).toBe("1200.5");
    expect(cleanAmount("1,200,000.00")).toBe("1200000");
  });

  it("handles European comma-decimal format", () => {
    expect(cleanAmount("1200,50")).toBe("1200.5");
  });

  it("preserves 18-decimal crypto value exactly", () => {
    const crypto = "0.000000000000000001";
    expect(cleanAmount(crypto)).toBe(crypto);
  });

  it("preserves values with more than 15 significant digits", () => {
    const precise = "123456789012345678.123456789012345678";
    expect(cleanAmount(precise)).toBe(precise);
  });

  it("handles negative values", () => {
    expect(cleanAmount("-500.25")).toBe("-500.25");
  });

  it("throws on non-numeric garbage", () => {
    expect(() => cleanAmount("abc")).toThrow();
    expect(() => cleanAmount("...")).toThrow();
  });
});

// ── validatePositiveRate ─────────────────────────────────────────────────────

describe("validatePositiveRate", () => {
  it("accepts a valid positive rate", () => {
    expect(validatePositiveRate("1.2345")).toBe("1.2345");
  });

  it("rejects zero", () => {
    expect(() => validatePositiveRate("0")).toThrow(/greater than zero/);
  });

  it("rejects negative", () => {
    expect(() => validatePositiveRate("-1")).toThrow(/greater than zero/);
  });

  it("normalizes European format", () => {
    expect(validatePositiveRate("1,25")).toBe("1.25");
  });

  it("rejects rate exceeding numeric(38,18) bounds", () => {
    expect(() => validatePositiveRate("1." + "9".repeat(19))).toThrow(/precision/);
  });
});

// ── validateAmount ───────────────────────────────────────────────────────────

describe("validateAmount", () => {
  it("accepts valid amounts", () => {
    expect(validateAmount("1000.50", "Net")).toBe("1000.5");
  });

  it("rejects negative amounts", () => {
    expect(() => validateAmount("-100", "Net")).toThrow(/must not be negative/);
  });

  it("rejects excessive scale", () => {
    expect(() => validateAmount("1.1234567890123456789", "Net")).toThrow(/exceeds/);
  });

  it("accepts 18 decimal places", () => {
    expect(validateAmount("0.000000000000000001", "Net")).toBe("0.000000000000000001");
  });
});

// ── validateBaseAmount ──────────────────────────────────────────────────────

describe("validateBaseAmount", () => {
  it("passes a value within numeric(18,4) bounds", () => {
    expect(validateBaseAmount("12345678901234.5678", "Base net")).toBe("12345678901234.5678");
  });

  it("returns null for null input", () => {
    expect(validateBaseAmount(null, "Base net")).toBeNull();
  });

  it("rejects a value that overflows numeric(18,4)", () => {
    expect(() => validateBaseAmount("123456789012345.6789", "Base net")).toThrow(/capacity/);
  });
});

// ── FIAT_TOLERANCE ───────────────────────────────────────────────────────────

describe("FIAT_TOLERANCE", () => {
  it("is 0.01", () => {
    expect(FIAT_TOLERANCE).toBe("0.01");
  });
});

// ── isAmountMismatch — fiat ──────────────────────────────────────────────────

describe("isAmountMismatch — fiat", () => {
  it("returns false when net + vat exactly equals gross", () => {
    expect(isAmountMismatch("1000", "200", "1200", "fiat")).toBe(false);
  });

  it("returns false when difference is within one-cent tolerance", () => {
    expect(isAmountMismatch("10", "2", "12.01", "fiat")).toBe(false);
    expect(isAmountMismatch("10", "2", "11.99", "fiat")).toBe(false);
  });

  it("returns true when difference exceeds one-cent tolerance", () => {
    expect(isAmountMismatch("100", "20", "120.02", "fiat")).toBe(true);
    expect(isAmountMismatch("100", "20", "119.98", "fiat")).toBe(true);
  });

  it("returns false for zero/partial entries", () => {
    expect(isAmountMismatch("0", "0", "0", "fiat")).toBe(false);
    expect(isAmountMismatch("100", "20", "0", "fiat")).toBe(false);
    expect(isAmountMismatch("0", "0", "120", "fiat")).toBe(false);
  });

  it("returns true for materially wrong gross", () => {
    expect(isAmountMismatch("1000", "200", "1300", "fiat")).toBe(true);
  });

  it("uses decimal arithmetic, not floating point", () => {
    expect(isAmountMismatch("0.1", "0.2", "0.3", "fiat")).toBe(false);
  });

  it("handles large fiat values without precision loss", () => {
    expect(isAmountMismatch("99999999999999.99", "0.01", "100000000000000.00", "fiat")).toBe(false);
  });
});

// ── isAmountMismatch — crypto ────────────────────────────────────────────────

describe("isAmountMismatch — crypto", () => {
  it("returns false when amounts match exactly", () => {
    expect(isAmountMismatch("0.000000000000000001", "0", "0.000000000000000001", "crypto")).toBe(false);
  });

  it("returns true for any difference in crypto mode", () => {
    expect(isAmountMismatch("1.000000000000000001", "0", "1.000000000000000002", "crypto")).toBe(true);
  });

  it("does not apply fiat tolerance to crypto", () => {
    expect(isAmountMismatch("1", "0", "1.005", "crypto")).toBe(true);
  });

  it("crypto values are not converted to cents", () => {
    const tiny = "0.000000000000000001";
    expect(isAmountMismatch(tiny, "0", tiny, "crypto")).toBe(false);
    expect(isAmountMismatch(tiny, "0", "0.000000000000000002", "crypto")).toBe(true);
  });

  it("handles crypto values with >15 significant digits", () => {
    const a = "12345678901234567.1";
    const b = "0.000000000000000001";
    const sum = "12345678901234567.100000000000000001";
    expect(isAmountMismatch(a, b, sum, "crypto")).toBe(false);
  });
});

// ── calculateBaseAmount ──────────────────────────────────────────────────────

describe("calculateBaseAmount", () => {
  it("returns original × fxRate rounded to 4dp", () => {
    expect(calculateBaseAmount("100", "1.2345")).toBe("123.4500");
  });

  it("uses ROUND_HALF_UP", () => {
    expect(calculateBaseAmount("1", "1.23455")).toBe("1.2346");
    expect(calculateBaseAmount("1", "1.23445")).toBe("1.2345");
    expect(calculateBaseAmount("1", "1.23465")).toBe("1.2347");
  });

  it("handles crypto amount × fiat rate", () => {
    const result = calculateBaseAmount("0.000000000000000001", "50000");
    expect(result).toBe("0.0000");
  });

  it("handles larger crypto amount × fiat rate", () => {
    const result = calculateBaseAmount("1.5", "50000");
    expect(result).toBe("75000.0000");
  });

  it("returns null for null inputs", () => {
    expect(calculateBaseAmount(null, "1")).toBeNull();
    expect(calculateBaseAmount("100", null)).toBeNull();
    expect(calculateBaseAmount(null, null)).toBeNull();
  });

  it("returns null for zero rate", () => {
    expect(calculateBaseAmount("100", "0")).toBeNull();
  });

  it("uses decimal arithmetic, not floating point", () => {
    expect(calculateBaseAmount("0.1", "3")).toBe("0.3000");
  });

  it("changing FX rate does not change original amount", () => {
    const original = "1000.50";
    const rate1 = "1.2";
    const rate2 = "1.5";
    const base1 = calculateBaseAmount(original, rate1);
    const base2 = calculateBaseAmount(original, rate2);
    expect(base1).toBe("1200.6000");
    expect(base2).toBe("1500.7500");
    expect(original).toBe("1000.50");
  });
});

// ── decimalAdd ───────────────────────────────────────────────────────────────

describe("decimalAdd", () => {
  it("adds two decimal strings exactly", () => {
    expect(decimalAdd("0.1", "0.2")).toBe("0.3");
  });

  it("handles 18-decimal values", () => {
    expect(decimalAdd("0.000000000000000001", "0.000000000000000001")).toBe("0.000000000000000002");
  });

  it("handles null/undefined as zero", () => {
    expect(decimalAdd(null, "5")).toBe("5");
    expect(decimalAdd("3", undefined)).toBe("3");
  });
});

// ── formatDisplayAmount ──────────────────────────────────────────────────────

describe("formatDisplayAmount", () => {
  it("formats fiat with 2 decimal places", () => {
    expect(formatDisplayAmount("1234.5", "fiat")).toBe("1234.50");
    expect(formatDisplayAmount("1000", "fiat")).toBe("1000.00");
  });

  it("formats crypto with significant digits, no trailing zeros", () => {
    expect(formatDisplayAmount("0.0012345", "crypto")).toBe("0.0012345");
    expect(formatDisplayAmount("1.000000000000000000", "crypto")).toBe("1");
    expect(formatDisplayAmount("0.000000000000000001", "crypto")).toBe("0.000000000000000001");
  });

  it("never displays non-zero crypto as 0.00", () => {
    const tiny = "0.00012345";
    const result = formatDisplayAmount(tiny, "crypto");
    expect(result).not.toBe("0.00");
    expect(result).toBe("0.00012345");
  });

  it("returns empty string for null/undefined", () => {
    expect(formatDisplayAmount(null)).toBe("");
    expect(formatDisplayAmount(undefined)).toBe("");
  });

  it("handles zero", () => {
    expect(formatDisplayAmount("0", "fiat")).toBe("0.00");
    expect(formatDisplayAmount("0", "crypto")).toBe("0");
  });
});

// ── Full validation path ─────────────────────────────────────────────────────

describe("decimal string survives full validation path", () => {
  it("18-decimal value is not corrupted through cleanAmount → toDecimal → validation", () => {
    const value = "0.000000000000000001";
    const cleaned = cleanAmount(value);
    expect(cleaned).toBe(value);
    const dec = toDecimal(value);
    expect(dec.toFixed(18)).toBe(value);
    expect(isAmountMismatch(value, "0", value, "crypto")).toBe(false);
  });

  it("value with >15 significant digits survives round-trip", () => {
    const value = "1234567890123456.78";
    const cleaned = cleanAmount(value);
    expect(cleaned).toBe(value);
    const dec = toDecimal(value);
    expect(dec.toFixed(2)).toBe(value);
  });

  it("exact decimal strings survive API/form transformations without Number conversion", () => {
    const value = "123456789.123456789012345678";
    const jsonBody = JSON.stringify({ netAmount: value });
    const parsed = JSON.parse(jsonBody);
    expect(typeof parsed.netAmount).toBe("string");
    expect(parsed.netAmount).toBe(value);
    expect(isAmountMismatch(parsed.netAmount, "0", parsed.netAmount, "crypto")).toBe(false);
  });
});

// ── FX rate independence ─────────────────────────────────────────────────────

describe("FX rate independence", () => {
  it("two invoices on the same date can have different rates", () => {
    const rate1 = "1.1234";
    const rate2 = "1.5678";
    const amount = "1000";
    const base1 = calculateBaseAmount(amount, rate1);
    const base2 = calculateBaseAmount(amount, rate2);
    expect(base1).toBe("1123.4000");
    expect(base2).toBe("1567.8000");
    expect(base1).not.toBe(base2);
  });

  it("same-currency invoice uses rate=1", () => {
    const amount = "500.25";
    const base = calculateBaseAmount(amount, "1");
    expect(base).toBe("500.2500");
  });
});

// ── Decimal separator rules ──────────────────────────────────────────────────

describe("decimal separator rules", () => {
  it("period decimal: '1234.56' → 1234.56", () => {
    expect(parseDecimalInput("1234.56")).toBe("1234.56");
  });

  it("US/UK thousands + period: '1,234.56' → 1234.56", () => {
    expect(parseDecimalInput("1,234.56")).toBe("1234.56");
  });

  it("European comma decimal: '1234,56' → 1234.56", () => {
    expect(parseDecimalInput("1234,56")).toBe("1234.56");
  });

  it("European thousands + comma: '1.234,56' → 1234.56", () => {
    expect(parseDecimalInput("1.234,56")).toBe("1234.56");
  });

  it("single comma followed by >3 digits is decimal: '1234,5678' → 1234.5678", () => {
    expect(parseDecimalInput("1234,5678")).toBe("1234.5678");
  });

  it("ambiguous single comma + exactly 3 digits rejects: '1,234'", () => {
    expect(() => parseDecimalInput("1,234")).toThrow(/[Aa]mbiguous/);
  });

  it("multiple commas are thousands: '1,234,567' → 1234567", () => {
    expect(parseDecimalInput("1,234,567")).toBe("1234567");
  });

  it("crypto with European comma: '0,000000000000000001'", () => {
    expect(parseDecimalInput("0,000000000000000001")).toBe("0.000000000000000001");
  });
});

// ── Strict decimal grammar ──────────────────────────────────────────────────

describe("strict decimal grammar", () => {
  it("rejects 'abc123' — arbitrary text before digits", () => {
    expect(() => parseDecimalInput("abc123")).toThrow(/[Ii]nvalid/);
  });

  it("rejects '12,34,567' — malformed thousands grouping", () => {
    expect(() => parseDecimalInput("12,34,567")).toThrow(/[Ii]nvalid/);
  });

  it("rejects '1,23.45' — invalid US grouping with non-3-digit group", () => {
    expect(() => parseDecimalInput("1,23.45")).toThrow(/[Ii]nvalid/);
  });

  it("rejects '1.23,45' — invalid European grouping with non-3-digit group", () => {
    expect(() => parseDecimalInput("1.23,45")).toThrow(/[Ii]nvalid/);
  });

  it("rejects embedded letters like '1a2b'", () => {
    expect(() => parseDecimalInput("1a2b")).toThrow(/[Ii]nvalid/);
  });

  it("accepts valid US format '12,345.67'", () => {
    expect(parseDecimalInput("12,345.67")).toBe("12345.67");
  });

  it("accepts valid European format '12.345,67'", () => {
    expect(parseDecimalInput("12.345,67")).toBe("12345.67");
  });

  it("accepts plain integer '12345'", () => {
    expect(parseDecimalInput("12345")).toBe("12345");
  });
});

// ── isVatRateValid ────────────────────────────────────────────────────────────

describe("isVatRateValid", () => {
  it("returns true for blank/null/undefined (blank allowed on drafts)", () => {
    expect(isVatRateValid("")).toBe(true);
    expect(isVatRateValid(null)).toBe(true);
    expect(isVatRateValid(undefined)).toBe(true);
    expect(isVatRateValid("   ")).toBe(true);
  });

  it("returns true for 0 (zero rate is valid)", () => {
    expect(isVatRateValid("0")).toBe(true);
  });

  it("returns true for typical rates like 19 and 21", () => {
    expect(isVatRateValid("19")).toBe(true);
    expect(isVatRateValid("21")).toBe(true);
  });

  it("returns true for 100 (boundary)", () => {
    expect(isVatRateValid("100")).toBe(true);
  });

  it("returns false for rates above 100", () => {
    expect(isVatRateValid("101")).toBe(false);
    expect(isVatRateValid("200")).toBe(false);
  });

  it("returns false for negative rates", () => {
    expect(isVatRateValid("-1")).toBe(false);
  });

  it("returns false for malformed input", () => {
    expect(isVatRateValid("abc")).toBe(false);
  });

  it("accepts decimal rates like 7.7", () => {
    expect(isVatRateValid("7.7")).toBe(true);
  });
});
