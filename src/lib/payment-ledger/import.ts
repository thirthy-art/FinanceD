import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { Decimal } from "@/src/lib/decimal";
import type { AssetType, BalanceDirection, PaymentEventType } from "./types";
import { isValidDateOnly } from "./validation";

export class PaymentImportError extends Error {}

export interface ImportedPaymentEvent {
  sourceRowNumber: number; sourceRowId: string | null; providerEventId: string | null; relatedProviderEventId: string | null; relatedPaymentAccountId: number | null; externalId: string | null; reference: string | null;
  eventDate: string; eventType: PaymentEventType; balanceDirection: BalanceDirection; balanceAmount: string;
  balanceAssetCode: string; balanceAssetType: AssetType; sourceAmount: string | null; sourceAssetCode: string | null;
  sourceAssetType: AssetType | null; actualFeeAmount: string | null; actualFeeAssetCode: string | null;
  expectedFxRate: string | null; reportedAvailableBalance: string | null; reportedReserveBalance: string | null;
  expectedReleaseDate: string | null; destinationAccountId: number | null; destinationAmount: string | null;
  destinationAssetCode: string | null; destinationAssetType: AssetType | null; expectedDestinationAmount: string | null;
  expectedDestinationRate: string | null; relatedEventId: number | null; finalReceipt: boolean; status: string | null; statusProvided: boolean;
  rawIdentifiers: string;
}

export interface ParsedPaymentImport { events: ImportedPaymentEvent[]; contentHash: string; rowCount: number; }

const ALIASES = {
  sourceRowId: ["source_row_id", "row_id"], providerEventId: ["provider_event_id", "source_event_id", "transaction_id"],
  relatedProviderEventId: ["related_provider_event_id", "related_transaction_id"], externalId: ["external_id", "payment_id", "psp_id"],
  relatedPaymentAccountId: ["related_payment_account_id", "source_payment_account_id"],
  reference: ["reference", "merchant_reference", "external_reference"], eventDate: ["event_date", "date", "transaction_date", "posting_date"],
  eventType: ["event_type", "transaction_type", "type", "operation"], direction: ["balance_direction", "economic_direction", "direction"],
  balanceAmount: ["balance_amount", "credited_amount", "debited_amount", "account_amount", "amount", "net_amount"],
  balanceAssetCode: ["balance_asset", "balance_currency", "account_asset", "currency"], balanceAssetType: ["balance_asset_type", "asset_type", "currency_type"],
  sourceAmount: ["source_amount", "transaction_amount", "gross_amount"], sourceAssetCode: ["source_asset", "transaction_currency", "source_currency"],
  sourceAssetType: ["source_asset_type", "source_currency_type"], actualFeeAmount: ["actual_fee", "fee_amount", "provider_fee"],
  actualFeeAssetCode: ["fee_asset", "fee_currency"], expectedFxRate: ["expected_fx_rate", "benchmark_rate"],
  reportedAvailableBalance: ["reported_balance", "balance_after", "available_balance"], reportedReserveBalance: ["reported_reserve_balance", "reserve_balance"],
  expectedReleaseDate: ["expected_release_date", "reserve_release_date"], destinationAccountId: ["destination_account_id"],
  destinationAmount: ["destination_amount", "received_amount"], destinationAssetCode: ["destination_asset", "destination_currency", "received_currency"],
  destinationAssetType: ["destination_asset_type"], expectedDestinationAmount: ["expected_destination_amount", "expected_received_amount"],
  expectedDestinationRate: ["expected_destination_rate", "expected_settlement_rate"], finalReceipt: ["final_receipt", "receipt_completes_transfer"],
  status: ["status", "transaction_status"],
} as const;

type Field = keyof typeof ALIASES;
const headerKey = (value: string) => value.trim().toLowerCase().replace(/[\s_\-./()]+/g, "");
const cell = (value: unknown) => value === null || value === undefined ? null : String(value).trim() || null;
const asset = (value: unknown) => { const result = cell(value)?.toUpperCase() ?? null; return result && /^[A-Z0-9][A-Z0-9._-]{0,19}$/.test(result) ? result : null; };
const decimal = (value: unknown) => {
  const raw = cell(value);
  if (raw === null) return null;
  try { const parsed = new Decimal(raw.replace(",", ".")); return parsed.isFinite() ? parsed.abs().toFixed() : null; } catch { return null; }
};
const signedDecimal = (value: unknown) => {
  const raw = cell(value); if (raw === null) return null;
  try { const parsed = new Decimal(raw.replace(",", ".")); return parsed.isFinite() ? parsed.toFixed() : null; } catch { return null; }
};
const integer = (value: unknown) => { const raw = cell(value); return raw && /^\d+$/.test(raw) ? Number(raw) : null; };
const assetType = (value: unknown): AssetType | null => { const raw = cell(value)?.toLowerCase(); return raw === "fiat" || raw === "crypto" ? raw : null; };
const booleanValue = (value: unknown) => { const raw = cell(value)?.toLowerCase(); return raw === "true" || raw === "yes" || raw === "1"; };

const EVENT_TYPES = new Set<PaymentEventType>(["deposit", "withdrawal", "refund", "chargeback", "fee", "adjustment", "settlement", "transfer", "reserve_hold", "reserve_release", "conversion"]);
function eventType(value: unknown): PaymentEventType | null {
  const normalized = cell(value)?.toLowerCase().replace(/[\s-]+/g, "_") as PaymentEventType | undefined;
  if (!normalized) return null;
  return EVENT_TYPES.has(normalized) ? normalized : null;
}
function defaultDirection(type: PaymentEventType, raw: unknown): BalanceDirection | null {
  const explicit = cell(raw)?.toLowerCase();
  if (explicit === "credit" || explicit === "in" || explicit === "increase") return "credit";
  if (explicit === "debit" || explicit === "out" || explicit === "decrease") return "debit";
  if (explicit === "none") return "none";
  if (type === "deposit") return "credit";
  if (["withdrawal", "refund", "chargeback", "fee", "settlement", "transfer"].includes(type)) return "debit";
  if (type === "reserve_hold" || type === "reserve_release") return "none";
  return null;
}

function normalize(rows: unknown[][]): ParsedPaymentImport {
  if (rows.length < 2) throw new PaymentImportError("The payment transaction file is empty.");
  const headers = rows[0].map((value) => cell(value) ?? "");
  const found = new Map<string, number>();
  headers.forEach((header, index) => found.set(headerKey(header), index));
  const columns = {} as Record<Field, number | null>;
  for (const field of Object.keys(ALIASES) as Field[]) columns[field] = ALIASES[field].map(headerKey).map((name) => found.get(name)).find((value) => value !== undefined) ?? null;
  for (const required of ["eventDate", "eventType", "balanceAmount", "balanceAssetCode", "balanceAssetType"] as Field[]) {
    if (columns[required] === null) throw new PaymentImportError(`Could not identify required column "${ALIASES[required][0]}". Use the canonical template or a recognized alias.`);
  }
  const events = rows.slice(1).filter((row) => row.some((value) => cell(value) !== null)).map((row, index): ImportedPaymentEvent => {
    const get = (field: Field) => columns[field] === null ? null : row[columns[field]!];
    const type = eventType(get("eventType"));
    if (!type) throw new PaymentImportError(`Row ${index + 2}: event type is missing or ambiguous; classify it explicitly.`);
    const direction = defaultDirection(type, get("direction"));
    if (!direction) throw new PaymentImportError(`Row ${index + 2}: balance direction is required for ${type}.`);
    if ((type === "deposit" && direction !== "credit") || (type === "withdrawal" && direction !== "debit")) throw new PaymentImportError(`Row ${index + 2}: ${type} has a contradictory balance direction.`);
    const amount = decimal(get("balanceAmount")); const balanceAsset = asset(get("balanceAssetCode")); const balanceType = assetType(get("balanceAssetType"));
    const date = cell(get("eventDate"));
    if (!date || !isValidDateOnly(date)) throw new PaymentImportError(`Row ${index + 2}: event date must be a real date in YYYY-MM-DD format.`);
    if (amount === null) throw new PaymentImportError(`Row ${index + 2}: balance amount must be a valid positive magnitude.`);
    if (!balanceAsset || !balanceType) throw new PaymentImportError(`Row ${index + 2}: balance asset code and fiat/crypto asset type are required.`);
    const sourceAmount = decimal(get("sourceAmount")); const sourceAsset = asset(get("sourceAssetCode")); const sourceType = assetType(get("sourceAssetType"));
    if ([sourceAmount, sourceAsset, sourceType].some((value) => value !== null) && [sourceAmount, sourceAsset, sourceType].some((value) => value === null)) throw new PaymentImportError(`Row ${index + 2}: source amount, asset, and asset type must be supplied together.`);
    const destinationAmount = decimal(get("destinationAmount")); const destinationAsset = asset(get("destinationAssetCode")); const destinationType = assetType(get("destinationAssetType"));
    if ([destinationAmount, destinationAsset, destinationType].some((value) => value !== null) && [destinationAmount, destinationAsset, destinationType].some((value) => value === null)) throw new PaymentImportError(`Row ${index + 2}: destination amount, asset, and asset type must be supplied together.`);
    const actualFeeAmount = decimal(get("actualFeeAmount")); const actualFeeAsset = asset(get("actualFeeAssetCode"));
    if ((actualFeeAmount === null) !== (actualFeeAsset === null)) throw new PaymentImportError(`Row ${index + 2}: actual fee amount and asset must be supplied together.`);
    const rawIdentifiers = JSON.stringify(Object.fromEntries(headers.map((header, column) => [header, cell(row[column])])));
    const expectedReleaseDate = cell(get("expectedReleaseDate"));
    if (expectedReleaseDate !== null && !isValidDateOnly(expectedReleaseDate)) throw new PaymentImportError(`Row ${index + 2}: expected release date must be a real date in YYYY-MM-DD format.`);
    const providerEventId = cell(get("providerEventId"));
    return { sourceRowNumber: index + 2, sourceRowId: cell(get("sourceRowId")), providerEventId, relatedProviderEventId: cell(get("relatedProviderEventId")), relatedPaymentAccountId: integer(get("relatedPaymentAccountId")), externalId: cell(get("externalId")) ?? providerEventId, reference: cell(get("reference")), eventDate: date,
      eventType: type, balanceDirection: direction, balanceAmount: amount, balanceAssetCode: balanceAsset, balanceAssetType: balanceType,
      sourceAmount, sourceAssetCode: sourceAsset, sourceAssetType: sourceType, actualFeeAmount, actualFeeAssetCode: actualFeeAsset,
      expectedFxRate: decimal(get("expectedFxRate")), reportedAvailableBalance: signedDecimal(get("reportedAvailableBalance")), reportedReserveBalance: signedDecimal(get("reportedReserveBalance")),
      expectedReleaseDate, destinationAccountId: integer(get("destinationAccountId")), destinationAmount, destinationAssetCode: destinationAsset,
      destinationAssetType: destinationType, expectedDestinationAmount: decimal(get("expectedDestinationAmount")), expectedDestinationRate: decimal(get("expectedDestinationRate")),
      relatedEventId: null, finalReceipt: booleanValue(get("finalReceipt")), status: cell(get("status")), statusProvided: columns.status !== null, rawIdentifiers };
  });
  if (events.length === 0) throw new PaymentImportError("The payment transaction file contains no data rows.");
  const contentHash = createHash("sha256").update(events.map((event) => JSON.stringify(event)).join("\n")).digest("hex");
  return { events, contentHash, rowCount: events.length };
}

function csv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let value = ""; let quoted = false;
  for (let index = 0; index < text.length; index++) { const char = text[index]; if (quoted) { if (char === '"' && text[index + 1] === '"') { value += '"'; index++; } else if (char === '"') quoted = false; else value += char; } else if (char === '"') quoted = true; else if (char === ",") { row.push(value); value = ""; } else if (char === "\n") { row.push(value); if (row.some((item) => item.trim())) rows.push(row); row = []; value = ""; } else if (char !== "\r") value += char; }
  row.push(value); if (row.some((item) => item.trim())) rows.push(row); return rows;
}
export function parsePaymentCsv(text: string) { return normalize(csv(text)); }
export async function parsePaymentXlsx(buffer: Uint8Array) {
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const worksheet = workbook.worksheets[0]; if (!worksheet) throw new PaymentImportError("The XLSX file has no worksheet.");
  const rows: unknown[][] = []; worksheet.eachRow((row) => rows.push((row.values as unknown[]).slice(1))); return normalize(rows);
}
