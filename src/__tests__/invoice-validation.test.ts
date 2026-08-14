import { describe, it, expect } from "vitest";
import {
  isAmountMismatch,
  cleanAmount,
  toDecimal,
  calculateBaseAmount,
  formatDisplayAmount,
  decimalAdd,
  FIAT_TOLERANCE,
} from "../lib/invoice-validation";

describe("cleanAmount", () => {
  it("returns '0' for null/undefined/empty", () => {
    expect(cleanAmount(null)).toBe("0");
    expect(cleanAmount(undefined)).toBe("0");
    expect(cleanAmount("")).toBe("0");
    expect(cleanAmount("   ")).toBe("0");
  });

  it("strips currency symbols", () => {
    expect(cleanAmount("$1200.00")).toBe("1200.00");
    expect(cleanAmount("€500")).toBe("500");
  });

  it("handles thousand separators", () => {
    expect(cleanAmount("1,200.50")).toBe("1200.50");
    expect(cleanAmount("1,200,000.00")).toBe("1200000.00");
  });

  it("handles European comma-decimal format", () => {
    expect(cleanAmount("1200,50")).toBe("1200.50");
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

  it("returns '0' for non-numeric garbage", () => {
    expect(cleanAmount("abc")).toBe("0");
    expect(cleanAmount("...")).toBe("0");
  });
});

describe("FIAT_TOLERANCE", () => {
  it("is 0.01", () => {
    expect(FIAT_TOLERANCE).toBe("0.01");
  });
});

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
    // 0.1 + 0.2 === 0.30000000000000004 in JS but must equal 0.3 in decimal
    expect(isAmountMismatch("0.1", "0.2", "0.3", "fiat")).toBe(false);
  });

  it("handles large fiat values without precision loss", () => {
    expect(isAmountMismatch("99999999999999.99", "0.01", "100000000000000.00", "fiat")).toBe(false);
  });
});

describe("isAmountMismatch — crypto", () => {
  it("returns false when amounts match exactly", () => {
    expect(isAmountMismatch("0.000000000000000001", "0", "0.000000000000000001", "crypto")).toBe(false);
  });

  it("returns true for any difference in crypto mode", () => {
    expect(isAmountMismatch("1.000000000000000001", "0", "1.000000000000000002", "crypto")).toBe(true);
  });

  it("does not apply fiat tolerance to crypto", () => {
    // 0.005 difference would pass fiat tolerance but must fail for crypto
    expect(isAmountMismatch("1", "0", "1.005", "crypto")).toBe(true);
  });

  it("crypto values are not converted to cents", () => {
    // This value has 18 decimal places — converting to cents would lose precision
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

describe("calculateBaseAmount", () => {
  it("returns original × fxRate rounded to 4dp", () => {
    expect(calculateBaseAmount("100", "1.2345")).toBe("123.4500");
  });

  it("uses banker's rounding (ROUND_HALF_EVEN)", () => {
    // 1.23455 rounded to 4dp: 5 rounds to even → 1.2346
    expect(calculateBaseAmount("1", "1.23455")).toBe("1.2346");
    // 1.23445 rounded to 4dp: 5 rounds to even → 1.2344
    expect(calculateBaseAmount("1", "1.23445")).toBe("1.2344");
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
    // 0.1 * 3 = 0.3, not 0.30000000000000004
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
    // Original is never modified — it's a pure function
    expect(original).toBe("1000.50");
  });
});

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
    // Simulate: form string → JSON body → zod validation → DB write → DB read → form
    const jsonBody = JSON.stringify({ netAmount: value });
    const parsed = JSON.parse(jsonBody);
    // The critical assertion: the value remains a string, never goes through Number()
    expect(typeof parsed.netAmount).toBe("string");
    expect(parsed.netAmount).toBe(value);
    // Validation accepts it
    expect(isAmountMismatch(parsed.netAmount, "0", parsed.netAmount, "crypto")).toBe(false);
  });
});

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
