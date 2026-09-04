import { and, eq } from "drizzle-orm";
import { getDb, type Db } from "@/src/db";
import {
  reconciliationImports,
  reconciliationMatches,
  reconciliationPaymentMatches,
  reconciliationPaymentRunItems,
  reconciliationRunItems,
  reconciliationRuns,
  reconciliationTransactions,
  paymentEvents,
} from "@/src/db/schema";
import { type IndexedTransaction, runReconciliation } from "./match";
import type {
  MatchPair,
  ReconciliationSource,
  ReconciliationTransaction,
} from "./types";
import { toReconciliationCandidate } from "@/src/lib/payment-ledger/calculations";

export interface ImportPersistedResult {
  importId: number;
  transactionIds: number[];
  reused: boolean;
}

export class DuplicateImportError extends Error {
  readonly previousImportId: number;
  constructor(importId: number) {
    super("This file has already been imported for the current company.");
    this.name = "DuplicateImportError";
    this.previousImportId = importId;
  }
}

export class ReconciliationSelectionError extends Error {}

async function findImportId(
  db: Db,
  companyId: number,
  sourceKind: ReconciliationSource,
  contentHash: string
): Promise<number | null> {
  const [row] = await db
    .select({ id: reconciliationImports.id })
    .from(reconciliationImports)
    .where(and(
      eq(reconciliationImports.companyId, companyId),
      eq(reconciliationImports.sourceKind, sourceKind),
      eq(reconciliationImports.contentHash, contentHash)
    ))
    .limit(1);
  return row?.id ?? null;
}

/** Persist an import once per company, source and normalized content. */
export async function createImport(
  companyId: number,
  sourceKind: ReconciliationSource,
  originalFilename: string,
  transactions: ReconciliationTransaction[],
  contentHash: string
): Promise<ImportPersistedResult> {
  const db = getDb();
  const existingId = await findImportId(db, companyId, sourceKind, contentHash);
  if (existingId !== null) {
    return { importId: existingId, transactionIds: [], reused: true };
  }

  const transactionIds = await db.transaction(async (tx) => {
    const [importRow] = await tx
      .insert(reconciliationImports)
      .values({
        companyId,
        sourceKind,
        originalFilename,
        contentHash,
        rowCount: transactions.length,
      })
      .returning({ id: reconciliationImports.id });

    const inserted: number[] = [];
    for (const txInfo of transactions) {
      const [row] = await tx
        .insert(reconciliationTransactions)
        .values({
          companyId,
          importId: importRow.id,
          source: sourceKind,
          externalId: txInfo.externalId,
          playerId: txInfo.playerId,
          transactionType: txInfo.transactionType,
          amount: txInfo.amount,
          currency: txInfo.currency,
          eventDate: txInfo.eventDate,
          reference: txInfo.reference,
          status: txInfo.status,
          statusProvided: txInfo.statusProvided,
        })
        .returning({ id: reconciliationTransactions.id });
      inserted.push(row.id);
    }
    return { importId: importRow.id, inserted };
  });

  return {
    importId: transactionIds.importId,
    transactionIds: transactionIds.inserted,
    reused: false,
  };
}

export interface ReconciliationResult {
  runId: number;
  playerLedgerImportId: number;
  pspImportId: number;
  matches: MatchPair[];
  ambiguousIds: number[];
  matchedPlayerIds: number[];
  matchedPspIds: number[];
}

/**
 * Reconcile exactly one player-ledger import against exactly one PSP import.
 * Both ids are required explicitly. The pair is persisted as an idempotent
 * run; historical imports are never selected or combined implicitly.
 */
export async function runAndPersistReconciliation(
  companyId: number,
  selected: { playerLedgerImportId: number; pspImportId: number }
): Promise<ReconciliationResult> {
  const db = getDb();
  const playerLedgerImportId = await resolveImportId(
    db,
    companyId,
    "player_ledger",
    selected.playerLedgerImportId
  );
  const pspImportId = await resolveImportId(
    db,
    companyId,
    "psp_transactions",
    selected.pspImportId
  );
  const runId = await getOrCreateRun(db, companyId, playerLedgerImportId, pspImportId);
  const ledger = await loadIndexed(db, companyId, "player_ledger", playerLedgerImportId);
  const canonicalPsp = await isCanonicalPaymentImport(db, companyId, pspImportId);
  const psp = canonicalPsp
    ? await loadCanonicalPaymentEvents(db, companyId, pspImportId)
    : await loadIndexed(db, companyId, "psp_transactions", pspImportId);
  const { matches, ambiguousIds } = runReconciliation(ledger, psp);

  await db.transaction(async (tx) => {
    if (canonicalPsp) {
      await tx.delete(reconciliationPaymentMatches).where(and(
        eq(reconciliationPaymentMatches.companyId, companyId),
        eq(reconciliationPaymentMatches.runId, runId)
      ));
      await tx.delete(reconciliationPaymentRunItems).where(and(
        eq(reconciliationPaymentRunItems.companyId, companyId),
        eq(reconciliationPaymentRunItems.runId, runId)
      ));
      await tx.delete(reconciliationRunItems).where(and(
        eq(reconciliationRunItems.companyId, companyId),
        eq(reconciliationRunItems.runId, runId)
      ));

      const matchedPlayerIds = new Set(matches.map((match) => match.playerTransactionId));
      const matchedEventIds = new Set(matches.map((match) => -match.pspTransactionId));
      const ambiguousIdSet = new Set(ambiguousIds);
      if (ledger.length > 0) {
        await tx.insert(reconciliationRunItems).values(ledger.map((transaction) => ({
          companyId, runId, transactionId: transaction.id,
          matchStatus: matchedPlayerIds.has(transaction.id) ? "matched" as const : ambiguousIdSet.has(transaction.id) ? "ambiguous" as const : "unmatched" as const,
        })));
      }
      if (psp.length > 0) {
        await tx.insert(reconciliationPaymentRunItems).values(psp.map((transaction) => ({
          companyId, runId, paymentEventId: -transaction.id,
          matchStatus: matchedEventIds.has(-transaction.id) ? "matched" as const : ambiguousIdSet.has(transaction.id) ? "ambiguous" as const : "unmatched" as const,
        })));
      }
      if (matches.length > 0) {
        await tx.insert(reconciliationPaymentMatches).values(matches.map((match) => ({
          companyId, runId, playerTransactionId: match.playerTransactionId, paymentEventId: -match.pspTransactionId, matchReason: match.matchedOn,
        })));
      }
      await tx.update(reconciliationRuns).set({ status: "completed", updatedAt: new Date() }).where(and(eq(reconciliationRuns.id, runId), eq(reconciliationRuns.companyId, companyId)));
      return;
    }
    await tx.delete(reconciliationMatches).where(and(
      eq(reconciliationMatches.companyId, companyId),
      eq(reconciliationMatches.runId, runId)
    ));
    await tx.delete(reconciliationRunItems).where(and(
      eq(reconciliationRunItems.companyId, companyId),
      eq(reconciliationRunItems.runId, runId)
    ));

    const matchedIds = new Set(
      matches.flatMap((match) => [match.playerTransactionId, match.pspTransactionId])
    );
    const ambiguousIdSet = new Set(ambiguousIds);
    const allTransactions = [...ledger, ...psp];
    if (allTransactions.length > 0) {
      await tx.insert(reconciliationRunItems).values(
        allTransactions.map((transaction) => ({
          companyId,
          runId,
          transactionId: transaction.id,
          matchStatus: matchedIds.has(transaction.id)
            ? "matched" as const
            : ambiguousIdSet.has(transaction.id)
              ? "ambiguous" as const
              : "unmatched" as const,
        }))
      );
    }

    if (matches.length > 0) {
      await tx.insert(reconciliationMatches).values(
        matches.map((match) => ({
          companyId,
          runId,
          playerTransactionId: match.playerTransactionId,
          pspTransactionId: match.pspTransactionId,
          matchReason: match.matchedOn,
        }))
      );
    }

    await tx
      .update(reconciliationRuns)
      .set({ status: "completed", updatedAt: new Date() })
      .where(and(eq(reconciliationRuns.id, runId), eq(reconciliationRuns.companyId, companyId)));
  });

  return {
    runId,
    playerLedgerImportId,
    pspImportId,
    matches,
    ambiguousIds,
    matchedPlayerIds: matches.map((match) => match.playerTransactionId),
    matchedPspIds: matches.map((match) => canonicalPsp ? -match.pspTransactionId : match.pspTransactionId),
  };
}

async function isCanonicalPaymentImport(db: Db, companyId: number, importId: number) {
  const [row] = await db.select({ paymentAccountId: reconciliationImports.paymentAccountId }).from(reconciliationImports).where(and(
    eq(reconciliationImports.id, importId), eq(reconciliationImports.companyId, companyId), eq(reconciliationImports.sourceKind, "psp_transactions")
  )).limit(1);
  return row?.paymentAccountId != null;
}

async function loadCanonicalPaymentEvents(db: Db, companyId: number, importId: number): Promise<IndexedTransaction[]> {
  const rows = await db.select({
    id: paymentEvents.id, companyId: paymentEvents.companyId, externalId: paymentEvents.externalId,
    reference: paymentEvents.reference, eventType: paymentEvents.eventType, balanceAmount: paymentEvents.balanceAmount,
    balanceAssetCode: paymentEvents.balanceAssetCode, sourceAmount: paymentEvents.sourceAmount,
    sourceAssetCode: paymentEvents.sourceAssetCode, status: paymentEvents.status, statusProvided: paymentEvents.statusProvided,
  }).from(paymentEvents).where(and(eq(paymentEvents.companyId, companyId), eq(paymentEvents.importId, importId))).orderBy(paymentEvents.id);
  return rows.map((row) => toReconciliationCandidate({ ...row,
    balanceAmount: String(row.balanceAmount), sourceAmount: row.sourceAmount === null ? null : String(row.sourceAmount),
  })).filter((row): row is IndexedTransaction => row !== null);
}

async function resolveImportId(
  db: Db,
  companyId: number,
  source: ReconciliationSource,
  requestedId: number
): Promise<number> {
  const [row] = await db
    .select({ id: reconciliationImports.id })
    .from(reconciliationImports)
    .where(and(
      eq(reconciliationImports.companyId, companyId),
      eq(reconciliationImports.sourceKind, source),
      eq(reconciliationImports.id, requestedId)
    ))
    .limit(1);

  if (!row) {
    const label = source === "player_ledger" ? "player-ledger" : "PSP";
    throw new ReconciliationSelectionError(`No valid ${label} import is available for this company.`);
  }
  return row.id;
}

async function getOrCreateRun(
  db: Db,
  companyId: number,
  playerLedgerImportId: number,
  pspImportId: number
): Promise<number> {
  const [created] = await db
    .insert(reconciliationRuns)
    .values({ companyId, playerLedgerImportId, pspImportId, status: "running" })
    .onConflictDoNothing()
    .returning({ id: reconciliationRuns.id });
  if (created) return created.id;

  const [existing] = await db
    .select({ id: reconciliationRuns.id })
    .from(reconciliationRuns)
    .where(and(
      eq(reconciliationRuns.companyId, companyId),
      eq(reconciliationRuns.playerLedgerImportId, playerLedgerImportId),
      eq(reconciliationRuns.pspImportId, pspImportId)
    ))
    .limit(1);
  if (!existing) throw new Error("The reconciliation run could not be created safely.");
  return existing.id;
}

async function loadIndexed(
  db: Db,
  companyId: number,
  source: ReconciliationSource,
  importId: number
): Promise<IndexedTransaction[]> {
  const rows = await db
    .select({
      id: reconciliationTransactions.id,
      companyId: reconciliationTransactions.companyId,
      source: reconciliationTransactions.source,
      externalId: reconciliationTransactions.externalId,
      reference: reconciliationTransactions.reference,
      playerId: reconciliationTransactions.playerId,
      transactionType: reconciliationTransactions.transactionType,
      amount: reconciliationTransactions.amount,
      currency: reconciliationTransactions.currency,
      status: reconciliationTransactions.status,
      statusProvided: reconciliationTransactions.statusProvided,
    })
    .from(reconciliationTransactions)
    .where(and(
      eq(reconciliationTransactions.companyId, companyId),
      eq(reconciliationTransactions.source, source),
      eq(reconciliationTransactions.importId, importId)
    ))
    .orderBy(reconciliationTransactions.id);

  return rows.map((row) => ({
    id: row.id,
    companyId: row.companyId,
    source: row.source as ReconciliationSource,
    externalId: row.externalId,
    reference: row.reference,
    playerId: row.playerId,
    transactionType: row.transactionType,
    amount: String(row.amount),
    currency: row.currency,
    status: row.status,
    statusProvided: row.statusProvided,
  }));
}
