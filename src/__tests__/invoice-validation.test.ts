import { describe, it, expect } from "vitest";
import { isAmountMismatch, parseAmount, AMOUNT_TOLERANCE } from "../lib/invoice-validation";

describe("AMOUNT_TOLERANCE", () => {
  it("is 0.01", () => {
    expect(AMOUNT_TOLERANCE).toBe(0.01);
  });
});

describe("isAmountMismatch", () => {
  // ── Happy paths ─────────────────────────────────────────────────────────────

  it("returns false when net + vat exactly equals gross", () => {
    expect(isAmountMismatch(1000, 200, 1200)).toBe(false);
  });

  it("returns false when difference is exactly at the tolerance boundary (0.01)", () => {
    // 10.00 + 2.00 = 12.00, gross = 12.01 → diff = 0.01, NOT > 0.01
    expect(isAmountMismatch(10, 2, 12.01)).toBe(false);
  });

  it("returns false for zero amounts (partial entry in progress)", () => {
    expect(isAmountMismatch(0, 0, 0)).toBe(false);
  });

  it("returns false when gross is zero (user has not entered gross yet)", () => {
    expect(isAmountMismatch(100, 20, 0)).toBe(false);
  });

  it("returns false when net is zero (user has not entered net yet)", () => {
    expect(isAmountMismatch(0, 0, 120)).toBe(false);
  });

  it("returns false for a typical VAT-inclusive invoice with exact amounts", () => {
    // 847.46 net + 161.02 VAT = 1008.48 gross
    expect(isAmountMismatch(847.46, 161.02, 1008.48)).toBe(false);
  });

  // ── Rounding tolerance ───────────────────────────────────────────────────────

  it("returns false when difference is 0.01 (acceptable rounding)", () => {
    // Common: per-line rounding produces a 1-cent total discrepancy
    expect(isAmountMismatch(100.0, 20.0, 120.01)).toBe(false);
    expect(isAmountMismatch(100.0, 20.0, 119.99)).toBe(false);
  });

  it("returns true when difference is 0.02 (beyond tolerance)", () => {
    expect(isAmountMismatch(100.0, 20.0, 120.02)).toBe(true);
    expect(isAmountMismatch(100.0, 20.0, 119.98)).toBe(true);
  });

  // ── Clear mismatches ─────────────────────────────────────────────────────────

  it("returns true when gross is materially wrong", () => {
    expect(isAmountMismatch(1000, 200, 1300)).toBe(true);
  });

  it("returns true when VAT is entered but net + vat overshoots gross", () => {
    // Someone typed gross before adjusting VAT
    expect(isAmountMismatch(500, 100, 550)).toBe(true);
  });

  it("returns true for a subtle 1-euro error in a large invoice", () => {
    expect(isAmountMismatch(10000, 2000, 12001)).toBe(true);
  });
});

describe("parseAmount", () => {
  it("parses a plain decimal string", () => {
    expect(parseAmount("1200.50")).toBeCloseTo(1200.5);
  });

  it("parses a string with thousand separator", () => {
    expect(parseAmount("1,200.50")).toBeCloseTo(1200.5);
  });

  it("returns 0 for null / undefined / empty", () => {
    expect(parseAmount(null)).toBe(0);
    expect(parseAmount(undefined)).toBe(0);
    expect(parseAmount("")).toBe(0);
  });

  it("ignores currency symbols", () => {
    expect(parseAmount("€1200.00")).toBeCloseTo(1200);
  });
});
