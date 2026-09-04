import { Decimal } from "@/src/lib/decimal";

export const CASH_FORECAST_DIRECTIONS = ["inflow", "outflow"] as const;
export type CashForecastDirection = typeof CASH_FORECAST_DIRECTIONS[number];

export const CASH_FORECAST_CATEGORIES = [
  "customer_receipts",
  "financing_inflow",
  "other_inflow",
  "payroll",
  "tax_vat",
  "rent",
  "debt_service",
  "other_outflow",
] as const;
export type CashForecastCategory = typeof CASH_FORECAST_CATEGORIES[number];

export const INFLOW_CATEGORIES = new Set<CashForecastCategory>([
  "customer_receipts", "financing_inflow", "other_inflow",
]);
export const OUTFLOW_CATEGORIES = new Set<CashForecastCategory>([
  "payroll", "tax_vat", "rent", "debt_service", "other_outflow",
]);

export interface ForecastManualItem {
  id: number;
  date: string;
  description: string;
  direction: CashForecastDirection;
  category: CashForecastCategory;
  amount: string;
}

export interface ForecastApItem {
  id: number;
  dueDate: string | null;
  baseGrossAmount: string | null;
  vendorName?: string | null;
  invoiceNumber?: string | null;
}

export interface ForecastWeek {
  index: number;
  start: string;
  end: string;
  openingCash: string;
  manualInflows: string;
  apOutflows: string;
  manualOutflows: string;
  netMovement: string;
  closingCash: string;
  manualItems: ForecastManualItem[];
  apItems: ForecastApItem[];
}

export interface CashForecastResult {
  weeks: ForecastWeek[];
  projectedClosingCash: string;
  lowestProjectedCash: string;
  lowestWeekIndex: number;
  firstBufferBreachWeekIndex: number | null;
  missingDueDateCount: number;
  missingBaseAmountCount: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL_RE = /^-?(?:0|[1-9]\d*)(?:\.\d{1,4})?$/;
const NONNEGATIVE_DECIMAL_RE = /^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/;

export function isValidDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function fitsNumeric18_4(value: string): boolean {
  const unsigned = value.startsWith("-") ? value.slice(1) : value;
  const [integer] = unsigned.split(".");
  return integer.length <= 14;
}

export function isValidBaseAmount(value: string, allowNegative: boolean): boolean {
  const pattern = allowNegative ? DECIMAL_RE : NONNEGATIVE_DECIMAL_RE;
  if (!pattern.test(value) || !fitsNumeric18_4(value)) return false;
  try {
    return new Decimal(value).isFinite();
  } catch {
    return false;
  }
}

export function isCategoryForDirection(
  category: CashForecastCategory,
  direction: CashForecastDirection,
): boolean {
  return direction === "inflow" ? INFLOW_CATEGORIES.has(category) : OUTFLOW_CATEGORIES.has(category);
}

function addDays(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

export function currentWeekStart(today: string): string {
  if (!isValidDate(today)) throw new Error("today must be a valid YYYY-MM-DD date");
  const date = new Date(`${today}T00:00:00.000Z`);
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  return addDays(today, -mondayOffset);
}

function weekIndexForDate(date: string, start: string): number | null {
  if (!isValidDate(date)) return null;
  if (date < start) return null;
  const diff = Math.floor((Date.parse(`${date}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`)) / 86_400_000);
  const index = Math.floor(diff / 7);
  return index >= 0 && index < 13 ? index : null;
}

function amount(value: Decimal): string {
  return value.toFixed(4);
}

export function calculateCashForecast(input: {
  today: string;
  openingCash: string;
  minimumBuffer: string;
  manualItems: ForecastManualItem[];
  apItems: ForecastApItem[];
}): CashForecastResult {
  const start = currentWeekStart(input.today);
  const manualByWeek = Array.from({ length: 13 }, () => [] as ForecastManualItem[]);
  const apByWeek = Array.from({ length: 13 }, () => [] as ForecastApItem[]);
  let missingDueDateCount = 0;
  let missingBaseAmountCount = 0;

  for (const item of input.manualItems) {
    const index = weekIndexForDate(item.date, start);
    if (index !== null) manualByWeek[index].push(item);
  }

  for (const invoice of input.apItems) {
    if (!invoice.dueDate || !isValidDate(invoice.dueDate)) {
      missingDueDateCount += 1;
      continue;
    }
    if (!invoice.baseGrossAmount || !isValidBaseAmount(invoice.baseGrossAmount, false)) {
      missingBaseAmountCount += 1;
      continue;
    }
    const index = invoice.dueDate < start ? 0 : weekIndexForDate(invoice.dueDate, start);
    if (index !== null) apByWeek[index].push(invoice);
  }

  let opening = new Decimal(input.openingCash);
  const buffer = new Decimal(input.minimumBuffer);
  const weeks: ForecastWeek[] = [];
  let lowest: Decimal | null = null;
  let lowestWeekIndex = 0;
  let firstBufferBreachWeekIndex: number | null = null;

  for (let index = 0; index < 13; index += 1) {
    const manualInflows = manualByWeek[index]
      .filter((item) => item.direction === "inflow")
      .reduce((sum, item) => sum.plus(item.amount), new Decimal(0));
    const manualOutflows = manualByWeek[index]
      .filter((item) => item.direction === "outflow")
      .reduce((sum, item) => sum.plus(item.amount), new Decimal(0));
    const apOutflows = apByWeek[index]
      .reduce((sum, item) => sum.plus(item.baseGrossAmount!), new Decimal(0));
    const net = manualInflows.minus(apOutflows).minus(manualOutflows);
    const closing = opening.plus(net);

    if (lowest === null || closing.lessThan(lowest)) {
      lowest = closing;
      lowestWeekIndex = index;
    }
    if (firstBufferBreachWeekIndex === null && closing.lessThan(buffer)) {
      firstBufferBreachWeekIndex = index;
    }

    weeks.push({
      index,
      start: addDays(start, index * 7),
      end: addDays(start, index * 7 + 6),
      openingCash: amount(opening),
      manualInflows: amount(manualInflows),
      apOutflows: amount(apOutflows),
      manualOutflows: amount(manualOutflows),
      netMovement: amount(net),
      closingCash: amount(closing),
      manualItems: manualByWeek[index],
      apItems: apByWeek[index],
    });
    opening = closing;
  }

  return {
    weeks,
    projectedClosingCash: weeks[12].closingCash,
    lowestProjectedCash: amount(lowest ?? new Decimal(input.openingCash)),
    lowestWeekIndex,
    firstBufferBreachWeekIndex,
    missingDueDateCount,
    missingBaseAmountCount,
  };
}
