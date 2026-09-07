const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateOnly(value: string): boolean {
  if (!DATE_ONLY.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

export function requireDateOnly(value: string, label: string): string {
  if (!isValidDateOnly(value)) throw new Error(`${label} must be a real date in YYYY-MM-DD format.`);
  return value;
}

export function validateDateRange(from: string, to: string | null | undefined): void {
  requireDateOnly(from, "Effective from");
  if (to !== null && to !== undefined && to !== "") {
    requireDateOnly(to, "Effective to");
    if (to < from) throw new Error("Effective to must be on or after effective from.");
  }
}
