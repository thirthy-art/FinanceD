import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/src/db";
import * as schema from "@/src/db/schema";
import {
  createImport,
  ReconciliationSelectionError,
  runAndPersistReconciliation,
} from "./service";
import type { ReconciliationTransaction } from "./types";

const HAS_DB = Boolean(process.env.DATABASE_URL);

const db = getDb();

async function cleanupCompany(companyId: number) {
  await db.delete(schema.reconciliationMatches).where(eq(schema.reconciliationMatches.companyId, companyId));
  await db.delete(schema.reconciliationRunItems).where(eq(schema.reconciliationRunItems.companyId, companyId));
  await db.delete(schema.reconciliationRuns).where(eq(schema.reconciliationRuns.companyId, companyId));
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
    statusProvided: false,
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
    statusProvided: false,
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
    statusProvided: true,
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
    statusProvided: true,
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
      const ledgerImport = await createImport(companyId, "player_ledger", "ledger.csv", LEDGER_TXS, "hash-ledger-2");
      const pspImport = await createImport(companyId, "psp_transactions", "psp.csv", PSP_TXS, "hash-psp-2");
      const result = await runAndPersistReconciliation(companyId, {
        playerLedgerImportId: ledgerImport.importId,
        pspImportId: pspImport.importId,
      });
      expect(result.matches).toHaveLength(2);

      const matchedRows = await db
        .select({ matchStatus: schema.reconciliationRunItems.matchStatus })
        .from(schema.reconciliationRunItems)
        .where(and(
          eq(schema.reconciliationRunItems.companyId, companyId),
          eq(schema.reconciliationRunItems.runId, result.runId)
        ));
      expect(matchedRows.every((r) => r.matchStatus === "matched")).toBe(true);

      const reasons = await db
        .select({ reason: schema.reconciliationMatches.matchReason })
        .from(schema.reconciliationMatches)
        .where(eq(schema.reconciliationMatches.runId, result.runId));
      expect(reasons.map((row) => row.reason)).toEqual([
        "external id ↔ reference",
        "external id ↔ reference",
      ]);
    } finally {
      await cleanupCompany(companyId);
    }
  });

  it.skipIf(!HAS_DB)("rejects another company's selected imports", async () => {
    const companyA = await freshCompany();
    const companyB = await freshCompany();
    try {
      const ledgerA = await createImport(companyA, "player_ledger", "ledger.csv", LEDGER_TXS, "ledger-a");
      const pspA = await createImport(companyA, "psp_transactions", "psp.csv", PSP_TXS, "psp-a");
      await expect(runAndPersistReconciliation(companyB, {
        playerLedgerImportId: ledgerA.importId,
        pspImportId: pspA.importId,
      })).rejects.toBeInstanceOf(ReconciliationSelectionError);
    } finally {
      await cleanupCompany(companyA);
      await cleanupCompany(companyB);
    }
  });

  it.skipIf(!HAS_DB)("keeps separate daily import pairs isolated and reruns idempotently", async () => {
    const companyId = await freshCompany();
    try {
      const ledgerDay1 = await createImport(companyId, "player_ledger", "ledger-1.csv", LEDGER_TXS, "ledger-day-1");
      const pspDay1 = await createImport(companyId, "psp_transactions", "psp-1.csv", PSP_TXS, "psp-day-1");
      const first = await runAndPersistReconciliation(companyId, {
        playerLedgerImportId: ledgerDay1.importId,
        pspImportId: pspDay1.importId,
      });

      const ledgerDay2Transactions = LEDGER_TXS.map((transaction, index) => ({
        ...transaction,
        externalId: `DAY2-${index}`,
        amount: index === 0 ? "25" : "5",
      }));
      const pspDay2Transactions = PSP_TXS.map((transaction, index) => ({
        ...transaction,
        externalId: `PSP-DAY2-${index}`,
        reference: `DAY2-${index}`,
        amount: index === 0 ? "25" : "5",
      }));
      const ledgerDay2 = await createImport(companyId, "player_ledger", "ledger-2.csv", ledgerDay2Transactions, "ledger-day-2");
      const pspDay2 = await createImport(companyId, "psp_transactions", "psp-2.csv", pspDay2Transactions, "psp-day-2");
      const second = await runAndPersistReconciliation(companyId, {
        playerLedgerImportId: ledgerDay2.importId,
        pspImportId: pspDay2.importId,
      });

      expect(second.runId).not.toBe(first.runId);
      const [persistedSecondRun] = await db
        .select({
          playerLedgerImportId: schema.reconciliationRuns.playerLedgerImportId,
          pspImportId: schema.reconciliationRuns.pspImportId,
        })
        .from(schema.reconciliationRuns)
        .where(eq(schema.reconciliationRuns.id, second.runId));
      expect(persistedSecondRun).toEqual({
        playerLedgerImportId: ledgerDay2.importId,
        pspImportId: pspDay2.importId,
      });
      const firstRunImports = await db
        .select({ importId: schema.reconciliationTransactions.importId })
        .from(schema.reconciliationRunItems)
        .innerJoin(
          schema.reconciliationTransactions,
          eq(schema.reconciliationRunItems.transactionId, schema.reconciliationTransactions.id)
        )
        .where(eq(schema.reconciliationRunItems.runId, first.runId));
      expect(new Set(firstRunImports.map((row) => row.importId))).toEqual(
        new Set([ledgerDay1.importId, pspDay1.importId])
      );

      const firstMatchesAfterSecondRun = await db
        .select({ id: schema.reconciliationMatches.id })
        .from(schema.reconciliationMatches)
        .where(eq(schema.reconciliationMatches.runId, first.runId));
      expect(firstMatchesAfterSecondRun).toHaveLength(2);

      const rerun = await runAndPersistReconciliation(companyId, {
        playerLedgerImportId: ledgerDay1.importId,
        pspImportId: pspDay1.importId,
      });
      expect(rerun.runId).toBe(first.runId);
      const runCount = await db
        .select({ id: schema.reconciliationRuns.id })
        .from(schema.reconciliationRuns)
        .where(eq(schema.reconciliationRuns.companyId, companyId));
      expect(runCount).toHaveLength(2);
    } finally {
      await cleanupCompany(companyId);
    }
  });
});
