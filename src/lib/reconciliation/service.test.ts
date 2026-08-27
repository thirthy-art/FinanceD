import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/src/db";
import * as schema from "@/src/db/schema";
import { createImport, runAndPersistReconciliation } from "./service";
import type { ReconciliationTransaction } from "./types";

const HAS_DB = Boolean(process.env.DATABASE_URL);

const db = getDb();

async function cleanupCompany(companyId: number) {
  await db.delete(schema.reconciliationMatches).where(eq(schema.reconciliationMatches.companyId, companyId));
  await db.delete(schema.reconciliationTransactions).where(eq(schema.reconciliationTransactions.companyId, companyId));
  await db.delete(schema.reconciliationImports).where(eq(schema.reconciliationImports.companyId, companyId));
  await db.delete(schema.companies).where(eq(schema.companies.id, companyId));
}

async function freshCompany(): Promise<number> {
  const [company] = await db
    .insert(schema.companies)
    .values({ name: `Reconciliation Test ${Date.now()}-${Math.random()}` })
    .returning();
  return company.id;
}

const LEDGER_TXS: ReconciliationTransaction[] = [
  {
    source: "player_ledger",
    externalId: "L-1",
    playerId: "p-1",
    transactionType: "deposit",
    amount: "100.00",
    currency: "EUR",
    eventDate: "2026-01-01",
    reference: null,
    status: null,
  },
  {
    source: "player_ledger",
    externalId: "L-2",
    playerId: "p-2",
    transactionType: "withdrawal",
    amount: "40.00",
    currency: "EUR",
    eventDate: "2026-01-02",
    reference: null,
    status: null,
  },
];

const PSP_TXS: ReconciliationTransaction[] = [
  {
    source: "psp_transactions",
    externalId: "P-1",
    playerId: null,
    transactionType: "deposit",
    amount: "100.00",
    currency: "EUR",
    eventDate: "2026-01-01",
    reference: "L-1",
    status: "settled",
  },
  {
    source: "psp_transactions",
    externalId: "P-2",
    playerId: null,
    transactionType: "withdrawal",
    amount: "40.00",
    currency: "EUR",
    eventDate: "2026-01-02",
    reference: "L-2",
    status: "settled",
  },
];

describe("reconciliation persistence (DB)", () => {
  it.skipIf(!HAS_DB)("rejects a duplicate import for the same company and source", async () => {
    const companyId = await freshCompany();
    try {
      const first = await createImport(companyId, "player_ledger", "ledger.csv", LEDGER_TXS, "hash-1");
      expect(first.reused).toBe(false);
      expect(first.transactionIds).toHaveLength(2);
      const second = await createImport(companyId, "player_ledger", "ledger.csv", LEDGER_TXS, "hash-1");
      expect(second.reused).toBe(true);
      expect(second.transactionIds).toHaveLength(0);
      expect(second.importId).toBe(first.importId);
    } finally {
      await cleanupCompany(companyId);
    }
  });

  it.skipIf(!HAS_DB)("keeps imports isolated per company", async () => {
    const companyA = await freshCompany();
    const companyB = await freshCompany();
    try {
      const inA = await createImport(companyA, "psp_transactions", "psp.csv", PSP_TXS, "hash-psp");
      const inB = await createImport(companyB, "psp_transactions", "psp.csv", PSP_TXS, "hash-psp");
      expect(inA.importId).not.toBe(inB.importId);

      const rowsA = await db
        .select({ id: schema.reconciliationTransactions.id })
        .from(schema.reconciliationTransactions)
        .where(eq(schema.reconciliationTransactions.companyId, companyA));
      const rowsB = await db
        .select({ id: schema.reconciliationTransactions.id })
        .from(schema.reconciliationTransactions)
        .where(eq(schema.reconciliationTransactions.companyId, companyB));
      expect(rowsA).toHaveLength(2);
      expect(rowsB).toHaveLength(2);
      expect(rowsA.map((r) => r.id)).not.toEqual(rowsB.map((r) => r.id));
    } finally {
      await cleanupCompany(companyA);
      await cleanupCompany(companyB);
    }
  });

  it.skipIf(!HAS_DB)("persists deterministic matches and marks statuses", async () => {
    const companyId = await freshCompany();
    try {
      await createImport(companyId, "player_ledger", "ledger.csv", LEDGER_TXS, "hash-ledger-2");
      await createImport(companyId, "psp_transactions", "psp.csv", PSP_TXS, "hash-psp-2");
      const result = await runAndPersistReconciliation(companyId);
      expect(result.matches).toHaveLength(2);

      const matchedRows = await db
        .select({ matchStatus: schema.reconciliationTransactions.matchStatus })
        .from(schema.reconciliationTransactions)
        .where(eq(schema.reconciliationTransactions.companyId, companyId));
      expect(matchedRows.every((r) => r.matchStatus === "matched")).toBe(true);
    } finally {
      await cleanupCompany(companyId);
    }
  });
});