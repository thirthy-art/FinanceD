import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  parseReconciliationCsv,
  parseReconciliationXlsx,
  ReconciliationImportError,
} from "./import";

const LEDGER_CSV = [
  "TransactionID,PlayerID,Type,Amount,Currency,Date",
  "L-1,p-1001,deposit,150.00,EUR,2026-01-05",
  "L-2,p-1002,withdrawal,40.00,EUR,2026-01-06",
].join("\n");

const PSP_CSV = `psp_id,merchant_reference,action,amount,currency,processing_date,status
P-900,ref-L-1,capture,150.00,EUR,2026-01-05,settled
P-901,ref-L-9,payout,40.00,EUR,2026-01-06,settled`;

async function buildXlsx(header: string[], rows: string[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("sheet");
  ws.addRow(header);
  for (const row of rows) ws.addRow(row.map((v) => (v === "" ? undefined : v)));
  return wb.xlsx.writeBuffer() as unknown as Buffer;
}

describe("CSV import normalization", () => {
  it("normalizes a player ledger CSV into canonical transactions", () => {
    const parsed = parseReconciliationCsv("player_ledger", LEDGER_CSV);
    expect(parsed.rowCount).toBe(2);
    expect(parsed.transactions[0]).toMatchObject({
      source: "player_ledger",
      externalId: "L-1",
      playerId: "p-1001",
      transactionType: "deposit",
      amount: "150",
      currency: "EUR",
      eventDate: "2026-01-05",
    });
    expect(parsed.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("throws a clear error when required columns are missing", () => {
    expect(() =>
      parseReconciliationCsv(
        "psp_transactions",
        "id,action\n1,deposit\n"
      )
    ).toThrow(ReconciliationImportError);
  });

  it("maps PSP vendor keywords (capture / payout) to canonical types", () => {
    const parsed = parseReconciliationCsv("psp_transactions", PSP_CSV);
    expect(parsed.transactions[0].transactionType).toBe("deposit");
    expect(parsed.transactions[1].transactionType).toBe("withdrawal");
    expect(parsed.transactions[0].status).toBe("settled");
  });
});

describe("XLSX import normalization", () => {
  it("normalizes an XLSX player ledger workbook", async () => {
    const buffer = await buildXlsx(
      ["Transaction ID", "Player ID", "Type", "Amount", "Currency", "Date", "Reference"],
      [
        ["TX-9", "p-9", "deposit", "25.50", "EUR", "2026-02-01", "ref-9"],
        ["TX-10", "p-10", "withdrawal", "10.00", "EUR", "2026-02-02", "ref-10"],
      ]
    );
    const parsed = await parseReconciliationXlsx("player_ledger", buffer);
    expect(parsed.rowCount).toBe(2);
    expect(parsed.transactions[0]).toMatchObject({
      externalId: "TX-9",
      playerId: "p-9",
      amount: "25.5",
      currency: "EUR",
      transactionType: "deposit",
    });
    expect(parsed.transactions[1].transactionType).toBe("withdrawal");
  });

  it("derives a different fingerprint for different content", async () => {
    const a = parseReconciliationCsv("player_ledger", LEDGER_CSV);
    const b = parseReconciliationCsv(
      "player_ledger",
      LEDGER_CSV.replace("150.00", "99999.00")
    );
    expect(a.contentHash).not.toBe(b.contentHash);
  });
});