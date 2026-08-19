import type ExcelJS from "exceljs";
import { decimalCellValue } from "@/src/lib/xlsx-helpers";

export function setDecimalAmountCell(cell: ExcelJS.Cell, value: string | null): void {
  const v = decimalCellValue(value);
  if (v === null) return;
  cell.value = v;
  cell.numFmt = "0.00";
}
