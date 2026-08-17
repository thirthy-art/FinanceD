import { Decimal } from "@/src/lib/decimal";
import type ExcelJS from "exceljs";

// Writes a decimal amount string as a plain numeric cell value.
// Uses Decimal for parsing to avoid floating-point errors. Falls back to a
// precision-preserving string when the amount cannot round-trip through
// IEEE 754 (e.g. high-precision crypto values).
export function setDecimalAmountCell(cell: ExcelJS.Cell, value: string | null): void {
  if (value === null || value.trim() === "") return;
  try {
    const dec = new Decimal(value);
    const num = dec.toNumber();
    cell.value = new Decimal(num).eq(dec) ? num : dec.toFixed();
    cell.numFmt = "0.00";
  } catch {
    cell.value = value;
  }
}
