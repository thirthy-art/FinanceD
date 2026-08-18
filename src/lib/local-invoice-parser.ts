import { Decimal } from "./decimal";

export interface InvoiceFields {
  vendorName?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  dueDate?: string;
  currency?: string;
  netAmount?: string;
  vatAmount?: string;
  grossAmount?: string;
}

type AmountField = "netAmount" | "vatAmount" | "grossAmount";

const CURRENCY_CODES = [
  "EUR", "USD", "GBP", "CHF", "CAD", "AUD", "RON", "JPY", "SEK", "NOK", "DKK", "ILS",
] as const;
const CURRENCY_CODE_PATTERN = CURRENCY_CODES.join("|");
const NUMBER_PATTERN = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?`;
const AMOUNT_PATTERN = new RegExp(
  String.raw`(?:[€£$]\s*)?(${NUMBER_PATTERN})(?:\s*(?:${CURRENCY_CODE_PATTERN}))?`,
  "gi",
);
const STANDALONE_AMOUNT_PATTERN = new RegExp(
  String.raw`^\s*(?:[€£$]\s*)?(${NUMBER_PATTERN})(?:\s*(?:${CURRENCY_CODE_PATTERN}))?\s*$`,
  "i",
);

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};
const MONTH_PATTERN = Object.keys(MONTHS).join("|");
const DATE_PATTERN = new RegExp(
  String.raw`\b(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|(?:${MONTH_PATTERN})\s+\d{1,2}(?:st|nd|rd|th)?[,]?\s+\d{4}|\d{1,2}(?:st|nd|rd|th)?\s+(?:${MONTH_PATTERN})[,]?\s+\d{4})\b`,
  "gi",
);

export function parseInvoiceFields(text: string): InvoiceFields {
  if (!text.trim()) return {};

  const fields: InvoiceFields = {};
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  fields.invoiceNumber = parseInvoiceNumber(lines);
  Object.assign(fields, parseDates(lines));
  fields.currency = parseCurrency(text);
  Object.assign(fields, parseAmounts(lines));

  // Preserve the pre-existing vendor-name heuristic unchanged.
  const invoiceIdx = lines.findIndex((line) => /\binvoice\b/i.test(line));
  const searchEnd = invoiceIdx > 0 ? Math.min(invoiceIdx, 4) : Math.min(lines.length, 4);
  for (const line of lines.slice(0, searchEnd)) {
    if (line.length > 3 && !/^(to:|from:|date:|bill|attention)/i.test(line)) {
      fields.vendorName = line;
      break;
    }
  }

  return removeUndefined(fields);
}

function parseInvoiceNumber(lines: string[]): string | undefined {
  for (const line of lines) {
    const match = line.match(/\binvoice\s*(?:(?:no\.?|number)|#)\s*:?\s*#?\s*([A-Z0-9][A-Z0-9/-]*)\b/i);
    if (match) return match[1];
  }

  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!/^invoice\s*:?$/i.test(lines[index])) continue;
    const match = lines[index + 1].match(/^#\s*([A-Z0-9][A-Z0-9/-]*)\s*$/i);
    if (match) return match[1];
  }

  return undefined;
}

function parseDates(lines: string[]): Pick<InvoiceFields, "invoiceDate" | "dueDate"> {
  const result: Pick<InvoiceFields, "invoiceDate" | "dueDate"> = {};
  const dateLines = lines.map(extractDates);
  const labels = lines.map(dateLabel);

  for (let index = 0; index < lines.length; index += 1) {
    const field = labels[index];
    if (!field || result[field]) continue;

    if (dateLines[index].length === 1) {
      result[field] = dateLines[index][0];
      continue;
    }

    if (labels[index - 1] || labels[index + 1]) continue;
    const following = dateLines[index + 1] ?? [];
    const preceding = dateLines[index - 1] ?? [];
    if (following.length === 1) result[field] = following[0];
    else if (preceding.length === 1) result[field] = preceding[0];
  }

  if (!result.invoiceDate && !result.dueDate) {
    const allDates = dateLines.flat();
    const hasInvoiceDateLabel = labels.includes("invoiceDate");
    const hasDueDateLabel = labels.includes("dueDate");
    if (hasInvoiceDateLabel && hasDueDateLabel && allDates.length === 2 && allDates[0] <= allDates[1]) {
      result.invoiceDate = allDates[0];
      result.dueDate = allDates[1];
    }
  }

  return result;
}

function dateLabel(line: string): "invoiceDate" | "dueDate" | undefined {
  if (/\b(?:due\s+date|payment\s+due)\b/i.test(line)) return "dueDate";
  if (/\binvoice\s+date\b/i.test(line) || /^date\b/i.test(line)) return "invoiceDate";
  return undefined;
}

function extractDates(line: string): string[] {
  const dates: string[] = [];
  for (const match of line.matchAll(DATE_PATTERN)) {
    const normalized = normalizeDate(match[0]);
    if (normalized) dates.push(normalized);
  }
  return dates;
}

function normalizeDate(raw: string): string | null {
  const numeric = raw.match(/^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})$/);
  if (numeric) {
    if (numeric[1].length === 4) {
      return validIsoDate(Number(numeric[1]), Number(numeric[2]), Number(numeric[3]));
    }
    let year = Number(numeric[3]);
    if (year < 100) year += year >= 50 ? 1900 : 2000;
    return validIsoDate(year, Number(numeric[2]), Number(numeric[1]));
  }

  const monthFirst = raw.match(new RegExp(String.raw`^(${MONTH_PATTERN})\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(\d{4})$`, "i"));
  if (monthFirst) {
    return validIsoDate(Number(monthFirst[3]), MONTHS[monthFirst[1].toLowerCase()], Number(monthFirst[2]));
  }

  const dayFirst = raw.match(new RegExp(String.raw`^(\d{1,2})(?:st|nd|rd|th)?\s+(${MONTH_PATTERN})[,]?\s+(\d{4})$`, "i"));
  if (dayFirst) {
    return validIsoDate(Number(dayFirst[3]), MONTHS[dayFirst[2].toLowerCase()], Number(dayFirst[1]));
  }

  return null;
}

function validIsoDate(year: number, month: number, day: number): string | null {
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1) return null;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day > daysInMonth[month - 1]) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseCurrency(text: string): string | undefined {
  const explicitCodes = new Set(
    [...text.matchAll(new RegExp(String.raw`\b(${CURRENCY_CODE_PATTERN})\b`, "gi"))]
      .map((match) => match[1].toUpperCase()),
  );
  if (explicitCodes.size === 1) return [...explicitCodes][0];
  if (explicitCodes.size > 1) return undefined;

  const inferred = new Set<string>();
  if (text.includes("€")) inferred.add("EUR");
  if (text.includes("£")) inferred.add("GBP");
  if (text.includes("$")) inferred.add("USD");
  return inferred.size === 1 ? [...inferred][0] : undefined;
}

function parseAmounts(lines: string[]): Pick<InvoiceFields, AmountField> {
  const result: Pick<InvoiceFields, AmountField> = {};
  const labels = lines.map(amountLabel);
  const standaloneAmounts = lines.map(extractStandaloneAmount);

  for (let index = 0; index < lines.length; index += 1) {
    const field = labels[index];
    if (!field || result[field]) continue;
    const amounts = extractAmounts(lines[index]);
    if (amounts.length === 1) result[field] = amounts[0];
  }

  applyAmountLabelBlocks(result, labels, standaloneAmounts);

  for (let index = 0; index < lines.length; index += 1) {
    const field = labels[index];
    if (!field || result[field]) continue;
    if (labels[index - 1] || labels[index + 1]) continue;
    const following = standaloneAmounts[index + 1];
    const preceding = standaloneAmounts[index - 1];
    if (following !== null && following !== undefined) result[field] = following;
    else if (preceding !== null && preceding !== undefined) result[field] = preceding;
  }

  return result;
}

function amountLabel(line: string): AmountField | null {
  if (/\b(?:gross(?:\s+amount)?|amount\s+due|balance\s+due|amount\s+payable|total)\b/i.test(line)) {
    return "grossAmount";
  }
  if (/\b(?:net(?:\s+amount)?|subtotal|before\s+tax)\b/i.test(line)) return "netAmount";
  if (/\b(?:vat(?:\s+amount)?|tax|gst)\b/i.test(line)) return "vatAmount";
  return null;
}

function extractAmounts(line: string): string[] {
  const withoutPercentages = line.replace(/\d+(?:\.\d+)?\s*%/g, "");
  const amounts: string[] = [];
  for (const match of withoutPercentages.matchAll(AMOUNT_PATTERN)) {
    const normalized = normalizeAmount(match[1]);
    if (normalized !== null) amounts.push(normalized);
  }
  return amounts;
}

function extractStandaloneAmount(line: string): string | null {
  const match = line.match(STANDALONE_AMOUNT_PATTERN);
  return match ? normalizeAmount(match[1]) : null;
}

function normalizeAmount(raw: string): string | null {
  const normalized = raw.replace(/,/g, "");
  try {
    new Decimal(normalized);
    return normalized;
  } catch {
    return null;
  }
}

function applyAmountLabelBlocks(
  result: Pick<InvoiceFields, AmountField>,
  labels: Array<AmountField | null>,
  amounts: Array<string | null>,
): void {
  for (let start = 0; start < labels.length; start += 1) {
    if (amounts[start] === null) continue;
    let amountEnd = start;
    while (amountEnd + 1 < amounts.length && amounts[amountEnd + 1] !== null) amountEnd += 1;
    const blockLength = amountEnd - start + 1;
    const labelStart = amountEnd + 1;
    if (blockLength >= 2 && blockLength <= 3 && isDistinctLabelBlock(labels, labelStart, blockLength)) {
      for (let offset = 0; offset < blockLength; offset += 1) {
        const field = labels[labelStart + offset] as AmountField;
        if (!result[field]) result[field] = amounts[start + offset] as string;
      }
    }
    start = amountEnd;
  }
}

function isDistinctLabelBlock(labels: Array<AmountField | null>, start: number, length: number): boolean {
  const block = labels.slice(start, start + length);
  return block.length === length && block.every(Boolean) && new Set(block).size === length;
}

function removeUndefined(fields: InvoiceFields): InvoiceFields {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}
