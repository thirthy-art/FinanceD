import { Decimal } from "@/src/lib/decimal";

export type Bucket =
  | "overdue"
  | "week1"
  | "week2"
  | "week3"
  | "week4"
  | "later"
  | "missing";

export const BUCKET_LABELS: Record<Bucket, string> = {
  overdue: "Overdue",
  week1: "Week 1",
  week2: "Week 2",
  week3: "Week 3",
  week4: "Week 4",
  later: "Later",
  missing: "Due date missing",
};

function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function classifyBucket(
  dueDate: string | null | undefined,
  today: string
): Bucket {
  if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return "missing";
  if (dueDate < today) return "overdue";
  if (dueDate <= addDays(today, 6)) return "week1";
  if (dueDate <= addDays(today, 13)) return "week2";
  if (dueDate <= addDays(today, 20)) return "week3";
  if (dueDate <= addDays(today, 27)) return "week4";
  return "later";
}

export function isDueThisMonth(
  dueDate: string | null | undefined,
  today: string
): boolean {
  if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return false;
  return dueDate >= today && dueDate.slice(0, 7) === today.slice(0, 7);
}

export interface CurrencyTotal {
  currency: string;
  total: string;
}

export function sumByCurrency(
  rows: Array<{ currency: string; grossAmount: string | null }>
): CurrencyTotal[] {
  const map = new Map<string, Decimal>();
  for (const { currency, grossAmount } of rows) {
    if (!grossAmount) continue;
    const prev = map.get(currency) ?? new Decimal(0);
    try {
      map.set(currency, prev.plus(new Decimal(grossAmount)));
    } catch {
      // skip unparseable amounts
    }
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, total]) => ({ currency, total: total.toFixed(2) }));
}

export function getWeekDateRange(
  today: string,
  week: 1 | 2 | 3 | 4
): { start: string; end: string } {
  const offset = (week - 1) * 7;
  return {
    start: addDays(today, offset),
    end: addDays(today, offset + 6),
  };
}

export function formatShortDate(dateStr: string): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
