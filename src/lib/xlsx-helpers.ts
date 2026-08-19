import { Decimal } from "@/src/lib/decimal";

/**
 * Converts a YYYY-MM-DD date string to a UTC-midnight Date for Excel.
 * Returns null for blank, malformed, or invalid dates.
 */
export function excelDateFromString(value: string | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Converts a decimal string to an Excel-safe cell value.
 *
 * Writes a JS number only when both:
 *   - significant digits <= 15  (Excel's numeric precision limit)
 *   - converting that number back to Decimal equals the original value
 * Otherwise writes the exact decimal string to preserve full precision.
 * Returns null for blank or malformed input.
 */
export function decimalCellValue(value: string | null): number | string | null {
  if (value === null || value.trim() === "") return null;
  try {
    const decimal = new Decimal(value);
    const numeric = decimal.toNumber();
    return decimal.sd() <= 15 && new Decimal(numeric).eq(decimal)
      ? numeric
      : decimal.toFixed();
  } catch {
    return null;
  }
}
