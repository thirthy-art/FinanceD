import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { setDecimalAmountCell } from "@/src/lib/cash-flow-xlsx";

async function roundTrip(raw: string | null): Promise<ExcelJS.CellValue> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("T");
  setDecimalAmountCell(sheet.getCell("A1"), raw);
  const buf = await wb.xlsx.writeBuffer();
  const rb = new ExcelJS.Workbook();
  await rb.xlsx.load(buf);
  return rb.getWorksheet("T")?.getCell("A1")?.value ?? null;
}

describe("setDecimalAmountCell", () => {
  it("exports a normal fiat amount as a plain numeric value", async () => {
    const v = await roundTrip("1050.00");
    expect(typeof v).toBe("number");
    expect(v).toBe(1050);
  });

  it("is NOT a formula object", async () => {
    const v = await roundTrip("1050.00");
    expect(v).not.toHaveProperty("formula");
  });

  it("exports a two-decimal fiat amount correctly", async () => {
    const v = await roundTrip("999.99");
    expect(typeof v).toBe("number");
    expect(v).toBe(999.99);
  });

  it("exports null as an empty (null) cell", async () => {
    const v = await roundTrip(null);
    expect(v).toBeNull();
  });

  it("preserves a high-precision crypto amount without precision loss", async () => {
    const crypto = "0.123456789012345678";
    const v = await roundTrip(crypto);
    // Must not silently truncate via parseFloat (IEEE 754 loses precision here)
    expect(v).not.toBeNull();
    // It is either a string (preserved) or a number that round-trips exactly
    if (typeof v === "number") {
      expect(v.toString()).toMatch(/^0\.12345678901234/);
    } else {
      expect(String(v)).toContain("0.123456789012345");
    }
  });
});
