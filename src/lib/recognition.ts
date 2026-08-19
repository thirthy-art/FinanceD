import { Decimal } from "./decimal";

Decimal.set({ rounding: Decimal.ROUND_HALF_UP });

const CRYPTO_DECIMAL_PLACES = 18;

export interface RecognitionScheduleRow {
  month: string; // YYYY-MM
  origAmount: string; // original-currency amount
  baseAmount: string; // base-currency, numeric(18,2)
}

/** Returns a YYYY-MM string for the first day of the month containing dateStr. */
function toMonth(dateStr: string): string {
  return dateStr.slice(0, 7);
}

/**
 * Enumerates every YYYY-MM from startMonth through endMonth inclusive.
 * Both must be YYYY-MM strings.
 */
function monthsBetween(startMonth: string, endMonth: string): string[] {
  const months: string[] = [];
  let [y, m] = startMonth.split("-").map(Number);
  const [ey, em] = endMonth.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return months;
}

/**
 * Derives the recognition schedule for a single invoice line.
 * No DB writes — pure derivation.
 *
 * @param netAmount   Original-currency net amount (string or number)
 * @param fxRate      Invoice-level FX rate to base currency (string or number)
 * @param treatment   "Immediate" | "Prepaid"
 * @param invoiceDate YYYY-MM-DD invoice date (used for Immediate)
 * @param startDate   YYYY-MM-DD recognition start (required for Prepaid)
 * @param endDate     YYYY-MM-DD recognition end (required for Prepaid)
 */
export function deriveRecognitionSchedule(params: {
  netAmount: string | number | null | undefined;
  fxRate: string | number | null | undefined;
  treatment: "Immediate" | "Prepaid";
  invoiceDate: string | null | undefined;
  startDate?: string | null;
  endDate?: string | null;
  currencyType?: "fiat" | "crypto";
}): RecognitionScheduleRow[] {
  const {
    netAmount,
    fxRate,
    treatment,
    invoiceDate,
    startDate,
    endDate,
    currencyType = "fiat",
  } = params;

  if (!netAmount) return [];

  const net = new Decimal(netAmount);
  const rate = new Decimal(fxRate ?? "1");

  if (treatment === "Immediate") {
    if (!invoiceDate) return [];
    const month = toMonth(invoiceDate);
    if (currencyType === "crypto") {
      const origAmt = net
        .toDecimalPlaces(CRYPTO_DECIMAL_PLACES, Decimal.ROUND_HALF_UP)
        .toFixed();
      const baseAmt = net.mul(rate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
      return [{ month, origAmount: origAmt, baseAmount: baseAmt }];
    }
    const origAmt = net.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
    const baseAmt = net.mul(rate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
    return [{ month, origAmount: origAmt, baseAmount: baseAmt }];
  }

  // Prepaid
  if (!startDate || !endDate) return [];
  const startMonth = toMonth(startDate);
  const endMonth = toMonth(endDate);
  const months = monthsBetween(startMonth, endMonth);
  if (months.length === 0) return [];

  const count = new Decimal(months.length);
  if (currencyType === "crypto") {
    const unroundedPerMonth = net.div(count);
    const perMonthOrig = unroundedPerMonth.toDecimalPlaces(
      CRYPTO_DECIMAL_PLACES,
      Decimal.ROUND_HALF_UP
    );
    const lastOrig = net.minus(perMonthOrig.mul(count.minus(1)));
    const totalBase = net.mul(rate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const perMonthBase = unroundedPerMonth
      .mul(rate)
      .toDecimalPlaces(2, Decimal.ROUND_DOWN);
    const lastBase = totalBase.minus(perMonthBase.mul(count.minus(1)));

    return months.map((month, i) => ({
      month,
      origAmount: (i === months.length - 1 ? lastOrig : perMonthOrig).toFixed(),
      baseAmount: (i === months.length - 1 ? lastBase : perMonthBase).toFixed(2),
    }));
  }

  const perMonth = net.div(count).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  // Residual goes to the final month (rounding difference)
  const sumExceptLast = perMonth.mul(count.minus(1));
  const lastOrig = net.minus(sumExceptLast).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  return months.map((month, i) => {
    const origAmt = (i === months.length - 1 ? lastOrig : perMonth).toFixed(2);
    const baseAmt = new Decimal(origAmt)
      .mul(rate)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
      .toFixed(2);
    return { month, origAmount: origAmt, baseAmount: baseAmt };
  });
}
