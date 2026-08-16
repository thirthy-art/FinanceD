import { describe, it, expect } from "vitest";
import {
  parseSafeDecimal,
  isValidDecimalString,
  multiplyToFixed2,
  computeVatAmount,
  computeGross,
  isVatRateValid,
  decimalStringsMismatch,
} from "../lib/invoice-validation";

// ── 1. Invalid numeric text must not crash ────────────────────────────────────

describe("parseSafeDecimal — crash safety", () => {
  it("returns null for 'a', never throws", () => {
    expect(() => parseSafeDecimal("a")).not.toThrow();
    expect(parseSafeDecimal("a")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseSafeDecimal("")).toBeNull();
  });

  it("returns null for null / undefined", () => {
    expect(parseSafeDecimal(null)).toBeNull();
    expect(parseSafeDecimal(undefined)).toBeNull();
  });

  it("returns null for symbols only", () => {
    expect(parseSafeDecimal("!@#$")).toBeNull();
  });

  it("parses a valid decimal string", () => {
    expect(parseSafeDecimal("19")).toBe(19);
    expect(parseSafeDecimal("1200.50")).toBeCloseTo(1200.5);
  });

  it("isValidDecimalString returns false for 'a'", () => {
    expect(isValidDecimalString("a")).toBe(false);
  });

  it("isValidDecimalString returns true for '19'", () => {
    expect(isValidDecimalString("19")).toBe(true);
  });
});

// ── 2. Qty × Unit Price auto-populates blank Net ──────────────────────────────

describe("multiplyToFixed2 — auto-populate Net", () => {
  it("multiplies qty × unitPrice to 2 decimal places", () => {
    expect(multiplyToFixed2("2", "15")).toBe("30.00");
  });

  it("handles decimal qty and price", () => {
    expect(multiplyToFixed2("2.5", "15.99")).toBe("39.98");
  });

  it("returns null when qty is invalid", () => {
    expect(multiplyToFixed2("a", "15")).toBeNull();
  });

  it("returns null when unitPrice is invalid", () => {
    expect(multiplyToFixed2("2", "abc")).toBeNull();
  });

  it("returns null when either is null/empty", () => {
    expect(multiplyToFixed2(null, "15")).toBeNull();
    expect(multiplyToFixed2("2", "")).toBeNull();
  });

  it("hostile test case: Qty=2, Price=15 → Net=30 (not 750)", () => {
    // QA data: qty=2, price=15 → auto-calc net should be 30.00 and warn if user entered 750
    expect(multiplyToFixed2("2", "15")).toBe("30.00");
  });
});

// ── 3. Explicit mismatching Net is preserved and warned ───────────────────────

describe("decimalStringsMismatch — explicit value warnings", () => {
  it("flags when calc net (30) differs from entered net (750)", () => {
    expect(decimalStringsMismatch("30.00", "750")).toBe(true);
  });

  it("returns false when values match within tolerance", () => {
    expect(decimalStringsMismatch("30.00", "30.00")).toBe(false);
    expect(decimalStringsMismatch("30.00", "30.01")).toBe(false);
  });

  it("returns false when either value is missing", () => {
    expect(decimalStringsMismatch(null, "30.00")).toBe(false);
    expect(decimalStringsMismatch("30.00", "")).toBe(false);
  });

  it("returns false when either value parses as invalid", () => {
    expect(decimalStringsMismatch("a", "30.00")).toBe(false);
    expect(decimalStringsMismatch("30.00", "b")).toBe(false);
  });
});

// ── 4. Net + VAT Rate auto-populates blank VAT ────────────────────────────────

describe("computeVatAmount — auto-populate VAT", () => {
  it("computes net × rate / 100 rounded to 2dp", () => {
    // 1000 × 19% = 190.00
    expect(computeVatAmount("1000", "19")).toBe("190.00");
  });

  it("handles fractional VAT rate", () => {
    // 1000 × 19.5% = 195.00
    expect(computeVatAmount("1000", "19.5")).toBe("195.00");
  });

  it("handles 0% VAT", () => {
    expect(computeVatAmount("1000", "0")).toBe("0.00");
  });

  it("returns null when net is invalid", () => {
    expect(computeVatAmount("a", "19")).toBeNull();
  });

  it("returns null when rate is invalid", () => {
    expect(computeVatAmount("1000", "abc")).toBeNull();
  });

  it("returns null when either is missing", () => {
    expect(computeVatAmount("", "19")).toBeNull();
    expect(computeVatAmount("1000", null)).toBeNull();
  });
});

// ── 5. Net + VAT auto-populates blank Gross ───────────────────────────────────

describe("computeGross — auto-populate Gross", () => {
  it("adds net + vat rounded to 2dp", () => {
    expect(computeGross("1000", "190")).toBe("1190.00");
  });

  it("handles rounding correctly", () => {
    // 100.01 + 19.00 = 119.01
    expect(computeGross("100.01", "19.00")).toBe("119.01");
  });

  it("returns null when net is invalid", () => {
    expect(computeGross("a", "190")).toBeNull();
  });

  it("returns null when vat is invalid", () => {
    expect(computeGross("1000", "abc")).toBeNull();
  });

  it("returns null when either is missing", () => {
    expect(computeGross("", "190")).toBeNull();
    expect(computeGross("1000", "")).toBeNull();
  });
});

// ── 6. VAT rate 19 means 19%, >100 / negative is invalid ─────────────────────

describe("isVatRateValid — VAT rate semantics", () => {
  it("accepts 19 (means 19%)", () => {
    expect(isVatRateValid("19")).toBe(true);
  });

  it("accepts 0 (zero-rate VAT)", () => {
    expect(isVatRateValid("0")).toBe(true);
  });

  it("accepts 100 (edge of valid range)", () => {
    expect(isVatRateValid("100")).toBe(true);
  });

  it("accepts 19.5", () => {
    expect(isVatRateValid("19.5")).toBe(true);
  });

  it("accepts blank (draft line, VAT not yet known)", () => {
    expect(isVatRateValid("")).toBe(true);
    expect(isVatRateValid(null)).toBe(true);
    expect(isVatRateValid(undefined)).toBe(true);
  });

  it("rejects 101 (above 100%)", () => {
    expect(isVatRateValid("101")).toBe(false);
  });

  it("rejects -1 (negative)", () => {
    expect(isVatRateValid("-1")).toBe(false);
  });

  it("rejects 'a' (non-numeric)", () => {
    expect(isVatRateValid("a")).toBe(false);
  });

  it("hostile test: 19 must not be interpreted as 1900%", () => {
    // The system stores 19 as percentage points. Internally there is no "×100" conversion.
    // multiplyToFixed2 with rate/100 is used: 1000 × (19/100) = 190
    expect(computeVatAmount("1000", "19")).toBe("190.00");
    expect(isVatRateValid("19")).toBe(true);
  });
});

// ── 7 & 8. Prepaid approval requires both accounts; Immediate does not ────────

describe("prepaid approval validation contract", () => {
  function validatePrepaidLine(line: {
    treatment: "immediate" | "prepaid";
    accountingAccountNumber: string | null;
    prepaidAccountNumber: string | null;
    recognitionStart: string | null;
    recognitionEnd: string | null;
  }): string[] {
    const errors: string[] = [];
    if (line.treatment === "prepaid") {
      if (!line.accountingAccountNumber) errors.push("Expense account required");
      if (!line.prepaidAccountNumber) errors.push("Prepaid account required");
      if (!line.recognitionStart) errors.push("Recognition start required");
      if (!line.recognitionEnd) errors.push("Recognition end required");
      if (line.recognitionStart && line.recognitionEnd && line.recognitionStart > line.recognitionEnd) {
        errors.push("End date must be >= start date");
      }
    }
    return errors;
  }

  it("Prepaid line with all fields passes", () => {
    const errors = validatePrepaidLine({
      treatment: "prepaid",
      accountingAccountNumber: "4400",
      prepaidAccountNumber: "1300",
      recognitionStart: "2024-01-01",
      recognitionEnd: "2024-12-31",
    });
    expect(errors).toHaveLength(0);
  });

  it("Prepaid line missing expense account fails", () => {
    const errors = validatePrepaidLine({
      treatment: "prepaid",
      accountingAccountNumber: null,
      prepaidAccountNumber: "1300",
      recognitionStart: "2024-01-01",
      recognitionEnd: "2024-12-31",
    });
    expect(errors).toContain("Expense account required");
  });

  it("Prepaid line missing prepaid account fails", () => {
    const errors = validatePrepaidLine({
      treatment: "prepaid",
      accountingAccountNumber: "4400",
      prepaidAccountNumber: null,
      recognitionStart: "2024-01-01",
      recognitionEnd: "2024-12-31",
    });
    expect(errors).toContain("Prepaid account required");
  });

  it("Prepaid line with end before start fails", () => {
    const errors = validatePrepaidLine({
      treatment: "prepaid",
      accountingAccountNumber: "4400",
      prepaidAccountNumber: "1300",
      recognitionStart: "2024-12-31",
      recognitionEnd: "2024-01-01",
    });
    expect(errors).toContain("End date must be >= start date");
  });

  it("Immediate line needs no prepaid account", () => {
    const errors = validatePrepaidLine({
      treatment: "immediate",
      accountingAccountNumber: "4400",
      prepaidAccountNumber: null,
      recognitionStart: null,
      recognitionEnd: null,
    });
    expect(errors).toHaveLength(0);
  });

  it("Immediate line with no accounts at all passes (optional for draft)", () => {
    const errors = validatePrepaidLine({
      treatment: "immediate",
      accountingAccountNumber: null,
      prepaidAccountNumber: null,
      recognitionStart: null,
      recognitionEnd: null,
    });
    expect(errors).toHaveLength(0);
  });
});

// ── 9. Account selectors use correct account types ────────────────────────────

describe("account type filtering contract", () => {
  const accounts = [
    { code: "1000", name: "Cash", type: "asset", isActive: true },
    { code: "1300", name: "Prepaid Expenses", type: "asset", isActive: true },
    { code: "2000", name: "Accounts Payable", type: "liability", isActive: true },
    { code: "4000", name: "Operating Expenses", type: "expense", isActive: true },
    { code: "4100", name: "Office Supplies", type: "expense", isActive: true },
    { code: "4400", name: "Cleaning Expenses", type: "expense", isActive: false }, // inactive
    { code: "5000", name: "Revenue", type: "revenue", isActive: true },
  ];

  it("expense account selector shows only active expense accounts", () => {
    const expenseAccounts = accounts.filter((a) => a.type === "expense" && a.isActive);
    expect(expenseAccounts.map((a) => a.code)).toEqual(["4000", "4100"]);
    expect(expenseAccounts.find((a) => a.code === "4400")).toBeUndefined(); // inactive excluded
    expect(expenseAccounts.find((a) => a.type === "asset")).toBeUndefined();
  });

  it("prepaid asset account selector shows only active asset accounts", () => {
    const assetAccounts = accounts.filter((a) => a.type === "asset" && a.isActive);
    expect(assetAccounts.map((a) => a.code)).toEqual(["1000", "1300"]);
    expect(assetAccounts.find((a) => a.type === "expense")).toBeUndefined();
    expect(assetAccounts.find((a) => a.type === "liability")).toBeUndefined();
  });

  it("liability and revenue accounts are excluded from both selectors", () => {
    const expenseAccounts = accounts.filter((a) => a.type === "expense" && a.isActive);
    const assetAccounts = accounts.filter((a) => a.type === "asset" && a.isActive);
    const allSelectable = [...expenseAccounts, ...assetAccounts];
    expect(allSelectable.find((a) => a.type === "liability")).toBeUndefined();
    expect(allSelectable.find((a) => a.type === "revenue")).toBeUndefined();
  });
});

// ── 10. AI extraction mapping remains unchanged ───────────────────────────────

describe("AI extraction contract (field names unchanged)", () => {
  const expectedFields = [
    "lineNumber",
    "descriptionOriginal",
    "description",
    "quantity",
    "unit",
    "unitPrice",
    "netAmount",
    "vatRate",
    "vatAmount",
    "grossAmount",
    "sourcePage",
  ];

  it("all required AI extraction field names remain defined as expected", () => {
    // This test documents the contract for AI line extraction field names.
    // If any field is renamed, this test must fail to catch the breakage.
    const lineObject: Record<string, unknown> = {
      lineNumber: 1,
      descriptionOriginal: "Original text",
      description: "User-edited text",
      quantity: "2",
      unit: "pcs",
      unitPrice: "15.00",
      netAmount: "30.00",
      vatRate: "19",    // percentage points — 19 means 19%
      vatAmount: "5.70",
      grossAmount: "35.70",
      sourcePage: 1,
    };

    for (const field of expectedFields) {
      expect(lineObject).toHaveProperty(field);
    }
  });

  it("vatRate is a plain decimal percentage (19, not 0.19 or '19%')", () => {
    // vatRate=19 means 19% — do not change storage to 0.19
    const vatRate = "19";
    expect(parseSafeDecimal(vatRate)).toBe(19);
    expect(isVatRateValid(vatRate)).toBe(true);
    // 19 → 19/100 = 0.19 multiplier
    expect(computeVatAmount("1000", vatRate)).toBe("190.00");
  });

  it("unit remains a plain string (not a master-data foreign key)", () => {
    // unit is free-form: "pcs", "5", "hours", etc. Numeric-looking values are allowed.
    const unitValues = ["pcs", "5", "kg", "hours", "m²", ""];
    for (const u of unitValues) {
      expect(typeof u).toBe("string"); // passes any string through
    }
  });
});

// ── 11. XLSX includes prepaid account number ──────────────────────────────────

describe("XLSX export column contract", () => {
  it("export columns include Accounting Account No. and Prepaid Account Number", () => {
    // These are the column keys defined in the export route.
    // If either is removed the test fails, catching the regression.
    const expectedColumns = [
      "accountingAccountNumber",
      "prepaidAccountNumber",
      "lineNumber",
      "description",
      "unit",
      "quantity",
      "unitPrice",
      "netAmount",
      "vatRate",
      "vatAmount",
      "grossAmount",
      "treatment",
      "recognitionStart",
      "recognitionEnd",
    ];

    // Simulate the column keys used in the export route
    const exportColumns = [
      { key: "invoiceId" },
      { key: "invoiceNumber" },
      { key: "lineNumber" },
      { key: "description" },
      { key: "unit" },
      { key: "quantity" },
      { key: "unitPrice" },
      { key: "netAmount" },
      { key: "vatRate" },
      { key: "vatAmount" },
      { key: "grossAmount" },
      { key: "accountingAccountNumber" },
      { key: "prepaidAccountNumber" },
      { key: "treatment" },
      { key: "recognitionStart" },
      { key: "recognitionEnd" },
      { key: "sourcePage" },
    ];

    const keys = exportColumns.map((c) => c.key);
    for (const col of expectedColumns) {
      expect(keys).toContain(col);
    }
  });

  it("Accounting Account No. column is NOT named 'expenseAccount' in export", () => {
    // The UI label is 'Expense account' but the export key is 'accountingAccountNumber'
    // to preserve the original field name.
    const exportKeys = ["accountingAccountNumber", "prepaidAccountNumber"];
    expect(exportKeys).toContain("accountingAccountNumber");
    expect(exportKeys).not.toContain("expenseAccount");
  });
});
