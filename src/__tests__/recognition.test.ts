import { describe, it, expect } from "vitest";
import { deriveRecognitionSchedule } from "@/src/lib/recognition";
import { Decimal } from "@/src/lib/decimal";

describe("deriveRecognitionSchedule", () => {
  describe("Immediate treatment", () => {
    it("returns a single row for the invoice month", () => {
      const rows = deriveRecognitionSchedule({
        netAmount: "300",
        fxRate: "1",
        treatment: "Immediate",
        invoiceDate: "2024-08-15",
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].month).toBe("2024-08");
      expect(rows[0].origAmount).toBe("300.00");
      expect(rows[0].baseAmount).toBe("300.00");
    });

    it("applies FX rate to base amount", () => {
      const rows = deriveRecognitionSchedule({
        netAmount: "100",
        fxRate: "1.08",
        treatment: "Immediate",
        invoiceDate: "2024-03-01",
      });
      expect(rows[0].origAmount).toBe("100.00");
      expect(rows[0].baseAmount).toBe("108.00");
    });

    it("returns empty when invoiceDate is missing", () => {
      const rows = deriveRecognitionSchedule({
        netAmount: "100",
        fxRate: "1",
        treatment: "Immediate",
        invoiceDate: null,
      });
      expect(rows).toHaveLength(0);
    });

    it("returns empty when netAmount is null", () => {
      const rows = deriveRecognitionSchedule({
        netAmount: null,
        fxRate: "1",
        treatment: "Immediate",
        invoiceDate: "2024-01-01",
      });
      expect(rows).toHaveLength(0);
    });
  });

  describe("Prepaid treatment — equal allocation", () => {
    it("EUR 300 Aug–Oct → 100 / 100 / 100", () => {
      const rows = deriveRecognitionSchedule({
        netAmount: "300",
        fxRate: "1",
        treatment: "Prepaid",
        invoiceDate: "2024-07-01",
        startDate: "2024-08-01",
        endDate: "2024-10-31",
      });
      expect(rows).toHaveLength(3);
      expect(rows.map((r) => r.month)).toEqual(["2024-08", "2024-09", "2024-10"]);
      expect(rows.map((r) => r.origAmount)).toEqual(["100.00", "100.00", "100.00"]);
      expect(rows.map((r) => r.baseAmount)).toEqual(["100.00", "100.00", "100.00"]);
    });

    it("single-month prepaid period", () => {
      const rows = deriveRecognitionSchedule({
        netAmount: "500",
        fxRate: "1",
        treatment: "Prepaid",
        invoiceDate: "2024-01-01",
        startDate: "2024-06-01",
        endDate: "2024-06-30",
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].month).toBe("2024-06");
      expect(rows[0].origAmount).toBe("500.00");
    });

    it("rounding residual goes to final month", () => {
      // 100 / 3 = 33.33... → 33.34 + 33.33 + 33.33 = 100.00
      const rows = deriveRecognitionSchedule({
        netAmount: "100",
        fxRate: "1",
        treatment: "Prepaid",
        invoiceDate: "2024-01-01",
        startDate: "2024-01-01",
        endDate: "2024-03-31",
      });
      expect(rows).toHaveLength(3);
      const total = rows.reduce((s, r) => s + parseFloat(r.origAmount), 0);
      expect(total.toFixed(2)).toBe("100.00");
      // residual in last month
      expect(rows[2].origAmount).toBe("33.34");
      expect(rows[0].origAmount).toBe("33.33");
      expect(rows[1].origAmount).toBe("33.33");
    });

    it("applies FX rate to each monthly base amount", () => {
      const rows = deriveRecognitionSchedule({
        netAmount: "300",
        fxRate: "1.2",
        treatment: "Prepaid",
        invoiceDate: "2024-01-01",
        startDate: "2024-08-01",
        endDate: "2024-10-31",
      });
      expect(rows[0].origAmount).toBe("100.00");
      expect(rows[0].baseAmount).toBe("120.00");
    });

    it("returns empty when startDate missing", () => {
      const rows = deriveRecognitionSchedule({
        netAmount: "100",
        fxRate: "1",
        treatment: "Prepaid",
        invoiceDate: "2024-01-01",
        startDate: null,
        endDate: "2024-03-31",
      });
      expect(rows).toHaveLength(0);
    });

    it("spans year boundary correctly", () => {
      const rows = deriveRecognitionSchedule({
        netAmount: "120",
        fxRate: "1",
        treatment: "Prepaid",
        invoiceDate: "2024-11-01",
        startDate: "2024-11-01",
        endDate: "2025-02-28",
      });
      expect(rows).toHaveLength(4);
      expect(rows.map((r) => r.month)).toEqual(["2024-11", "2024-12", "2025-01", "2025-02"]);
      expect(rows.map((r) => r.origAmount)).toEqual(["30.00", "30.00", "30.00", "30.00"]);
    });
  });

  describe("crypto treatment", () => {
    it("preserves original precision before immediate FX conversion", () => {
      const rows = deriveRecognitionSchedule({
        netAmount: "0.000001",
        fxRate: "3000",
        currencyType: "crypto",
        treatment: "Immediate",
        invoiceDate: "2024-01-01",
      });

      expect(rows).toEqual([
        { month: "2024-01", origAmount: "0.000001", baseAmount: "0.00" },
      ]);
    });

    it("preserves and reconciles prepaid allocations before FX conversion", () => {
      const rows = deriveRecognitionSchedule({
        netAmount: "0.001",
        fxRate: "100000",
        currencyType: "crypto",
        treatment: "Prepaid",
        invoiceDate: "2024-01-01",
        startDate: "2024-01-01",
        endDate: "2024-12-31",
      });

      expect(rows).toHaveLength(12);
      expect(rows.every((row) => !new Decimal(row.origAmount).isZero())).toBe(true);
      expect(rows[0]).toEqual({
        month: "2024-01",
        origAmount: "0.000083333333333333",
        baseAmount: "8.33",
      });
      expect(rows[11]).toEqual({
        month: "2024-12",
        origAmount: "0.000083333333333337",
        baseAmount: "8.37",
      });

      const origTotal = rows.reduce(
        (total, row) => total.plus(row.origAmount),
        new Decimal(0)
      );
      const baseTotal = rows.reduce(
        (total, row) => total.plus(row.baseAmount),
        new Decimal(0)
      );
      expect(origTotal.toFixed()).toBe("0.001");
      expect(baseTotal.toFixed(2)).toBe("100.00");
    });
  });
});
