import { createHash } from "node:crypto";
import { Decimal } from "@/src/lib/decimal";
import ExcelJS from "exceljs";
import type {
  ReconciliationSource,
  ReconciliationTransaction,
  ReconciliationTransactionType,
} from "./types";

/**
 * Import row normalization: accepts either a Player Ledger file or a PSP
 * Transactions file (CSV or XLSX) and maps recognizable columns into the
 * canonical reconciliation transaction shape.
 *
 * Column recognition is deliberate, not AI-assisted. When required fields
 * cannot be identified a clear error is returned so the caller can surface a
 * useful message to the user.
 */

export class ReconciliationImportError extends Error {}

export interface ParsedImport {
  transactions: ReconciliationTransaction[];
  /** Stable SHA-256 fingerprint of the normalized rows (duplicate guard). */
  contentHash: string;
  rowCount: number;
}

type HeaderMap = {
  externalId: string | null;
  playerId: string | null;
  transactionType: string | null;
  amount: string | null;
  currency: string | null;
  eventDate: string | null;
  reference: string | null;
  status: string | null;
};

function buildHeaderMap(seenHeaders: string[]): HeaderMap {
  const normalized = new Map<string, string>();
  for (const header of seenHeaders) {
    const key = normalizeHeader(header);
    if (!normalized.has(key)) normalized.set(key, header);
    else normalized.set(key, `${header}__${key}`);
  }

  const map: HeaderMap = {
    externalId: null,
    playerId: null,
    transactionType: null,
    amount: null,
    currency: null,
    eventDate: null,
    reference: null,
    status: null,
  };

  const assign = (field: keyof HeaderMap, key: string) => {
    if (map[field] === null) map[field] = normalized.get(normalizeHeader(key)) ?? null;
  };

  for (const key of EXTERNAL_ID_HEADERS) assign("externalId", key);
  for (const key of PLAYER_ID_HEADERS) assign("playerId", key);
  for (const key of TYPE_HEADERS) assign("transactionType", key);
  for (const key of AMOUNT_HEADERS) assign("amount", key);
  for (const key of CURRENCY_HEADERS) assign("currency", key);
  for (const key of DATE_HEADERS) assign("eventDate", key);
  for (const key of REFERENCE_HEADERS) assign("reference", key);
  for (const key of STATUS_HEADERS) assign("status", key);

  return map;
}

function validateHeaderMap(source: ReconciliationSource, map: HeaderMap) {
  const required: Array<{ key: "transactionType" | "amount" | "currency"; label: string }> = [
    { key: "transactionType", label: "transaction type" },
    { key: "amount", label: "amount" },
    { key: "currency", label: "currency" },
  ];
  for (const { key, label } of required) {
    if (!map[key]) {
      const sourceLabel =
        source === "player_ledger" ? "player ledger" : "PSP transactions";
      throw new ReconciliationImportError(
        `Could not identify a "${label}" column in the ${sourceLabel} file. ` +
          `Required columns: transaction type, amount and currency.`
      );
    }
  }
}

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_\-./]+/g, "")
    .replace(/[()]/g, "");
}

const EXTERNAL_ID_HEADERS = [
  "transactionid", "referenceid", "externaltxnid", "paymentid",
  "paymentreference", "orderid", "pspid", "psptransactionid", "pspreference",
  "transactionno", "transactionnumber", "id",
];
const PLAYER_ID_HEADERS = ["playerid", "player", "userid", "username", "accountid", "customerid"];
const TYPE_HEADERS = [
  "transactiontype", "type", "action", "transaction", "trxtype", "operation",
  "activity", "kind",
];
const AMOUNT_HEADERS = ["amount", "grossamount", "netamount", "value", "sum", "transactionamount"];
const CURRENCY_HEADERS = ["currency", "curency", "currencycode", "ccycurrency", "iso"];
const DATE_HEADERS = [
  "date", "eventdate", "transactiondate", "datetime", "createddate", "createdat",
  "processingdate", "postingdate", "settlementdate",
];
const REFERENCE_HEADERS = ["reference", "externalreference", "innemerchantref", "merchantreference"];
const STATUS_HEADERS = [
  "status", "transactionstatus", "state", "result", "validstatus", "pspstatus",
];

// ─── Typed cell extraction ────────────────────────────────────────────────────

function textCell(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

/** Excel serial date cells come through as numbers; convert them to YYYY-MM-DD. */
function dateCell(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    // Excel serial date (days since 1899-12-30).
    const ms = Math.round((value - 25569) * 86400000);
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return null;
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return textCell(value);
}

function parseType(raw: string | null): ReconciliationTransactionType | null {
  if (!raw) return null;
  const normalized = raw.trim().toLowerCase();
  const deposits = ["deposit", "dep", "credit", "in", "capture", "topup", "payment", "crd", "+"];
  const withdrawals = ["withdrawal", "wd", "withdraw", "debit", "out", "payout", "payoff", "-"];
  if (deposits.includes(normalized)) return "deposit";
  if (withdrawals.includes(normalized)) return "withdrawal";
  return null;
}

/** Normalize a numeric cell to a canonical decimal string. */
function amountCell(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    const decimal = new Decimal(String(value));
    return decimal.isFinite() ? decimal.abs().toFixed() : null;
  }
  const raw = textCell(value);
  if (!raw) return null;
  const normalized = raw.replace(",", ".");
  if (normalized === "") return null;
  try {
    const decimal = new Decimal(normalized);
    return decimal.isFinite() ? decimal.abs().toFixed() : null;
  } catch {
    return null;
  }
}

function cleanCurrency(value: string | null): string | null {
  if (!value) return null;
  const cleaned = value.trim().toUpperCase();
  return cleaned === "" ? null : cleaned;
}

// ─── Row assembly ─────────────────────────────────────────────────────────────

function buildTransaction(
  source: ReconciliationSource,
  row: Record<string, unknown>,
  map: HeaderMap
): ReconciliationTransaction {
  const transactionType = parseType(
    map.transactionType ? textCell(row[map.transactionType]) : null
  );
  const amount = map.amount ? amountCell(row[map.amount]) : null;
  const currency = map.currency ? cleanCurrency(textCell(row[map.currency])) : null;

  if (!transactionType) {
    throw new ReconciliationImportError(
      `Unrecognized transaction type on a row with amount "${amount ?? ""}". ` +
        `Expected a deposit or withdrawal type.`
    );
  }
  if (amount === null) {
    throw new ReconciliationImportError(
      `Missing or invalid amount on a row. Amount must be a number.`
    );
  }
  if (currency === null) {
    throw new ReconciliationImportError(
      `Missing or invalid currency on a row.`
    );
  }

  return {
    source,
    externalId: map.externalId ? textCell(row[map.externalId]) : null,
    playerId: map.playerId ? textCell(row[map.playerId]) : null,
    transactionType,
    amount,
    currency,
    eventDate: map.eventDate ? dateCell(row[map.eventDate]) : null,
    reference: map.reference ? textCell(row[map.reference]) : null,
    status: map.status ? textCell(row[map.status]) : null,
    statusProvided: map.status !== null,
  };
}

// ─── CSV parsing ──────────────────────────────────────────────────────────────

function parseCsvSource(data: string): string[][] {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < data.length; i++) {
    const char = data[i];
    if (inQuotes) {
      if (char === '"') {
        if (data[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      current.push(field);
      field = "";
    } else if (char === "\n") {
      current.push(field);
      field = "";
      if (current.some((cell) => cell.trim() !== "")) rows.push(current);
      current = [];
    } else if (char === "\r") {
      // skip
    } else {
      field += char;
    }
  }
  current.push(field);
  if (current.some((cell) => cell.trim() !== "")) rows.push(current);

  return rows;
}

// ─── Entry point ──────────────────────────────────────────────────────────────

function normalizeImport(
  source: ReconciliationSource,
  rows: string[][]
): ParsedImport {
  if (rows.length === 0) {
    throw new ReconciliationImportError("The uploaded file is empty.");
  }
  const headerRow = rows[0].map((h) => h.trim());
  const map = buildHeaderMap(headerRow);
  validateHeaderMap(source, map);

  const transactions: ReconciliationTransaction[] = [];
  for (let i = 1; i < rows.length; i++) {
    const rowCells = rows[i];
    const row: Record<string, unknown> = {};
    for (let j = 0; j < headerRow.length; j++) {
      row[headerRow[j]] = rowCells[j] ?? null;
    }
    transactions.push(buildTransaction(source, row, map));
  }

  return {
    transactions,
    contentHash: fingerprintTransactions(transactions),
    rowCount: transactions.length,
  };
}

export function parseReconciliationCsv(
  kind: ReconciliationSource,
  text: string
): ParsedImport {
  return normalizeImport(kind, parseCsvSource(text));
}

export async function parseReconciliationXlsx(
  kind: ReconciliationSource,
  buffer: Uint8Array
): Promise<ParsedImport> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new ReconciliationImportError("The uploaded XLSX file has no worksheets.");
  }

  const rows: string[][] = [];
  worksheet.eachRow((excelRow) => {
    const values = (excelRow.values as unknown[]).slice(1);
    const cells = values.map((v) => {
      if (v && typeof v === "object" && "text" in (v as { text?: unknown })) {
        return String((v as { text?: unknown }).text ?? "");
      }
      return v === null || v === undefined ? "" : String(v);
    });
    if (cells.some((c) => c.trim() !== "")) rows.push(cells);
  });

  return normalizeImport(kind, rows);
}

/**
 * Content fingerprint for the duplicate guard. Built only from normalized
 * canonical values so a re-upload of the same logical content is caught even
 * if the file metadata or blank cells differ slightly.
 */
export function fingerprintTransactions(
  transactions: ReconciliationTransaction[]
): string {
  const lines = transactions
    .map((tx) =>
      [
        tx.source,
        tx.externalId,
        tx.playerId,
        tx.transactionType,
        tx.amount,
        tx.currency,
        tx.eventDate,
        tx.reference,
        tx.status,
        tx.statusProvided,
      ]
        .map((v) => (v === null || v === undefined ? "" : String(v)))
        .join("|")
    )
    .sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}
