import { and, eq, sql } from "drizzle-orm";
import { getDb, type Db } from "@/src/db";
import {
  reconciliationImports,
  reconciliationMatches,
  reconciliationTransactions,
} from "@/src/db/schema";
import {
  type IndexedTransaction,
  runReconciliation,
} from "./match";
import type {
  MatchPair,
  ReconciliationSource,
  ReconciliationTransaction,
} from "./types";

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

async function findImportId(
  db: Db,
  companyId: number,
  sourceKind: ReconciliationSource,
  contentHash: string
): Promise<number | null> {
  const [row] = await db
    .select({ id: reconciliationImports.id })
    .from(reconciliationImports)
    .where(
      and(
        eq(reconciliationImports.companyId, companyId),
        eq(reconciliationImports.sourceKind, sourceKind),
        eq(reconciliationImports.contentHash, contentHash)
      )
    )
    .limit(1);
  return row?.id ?? null;
}

/**
 * Insert a parsed import for a company. If the same content has already been
 * imported for the same company+source, returns a reused result without
 * duplicating transaction rows.
 */
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
  matches: MatchPair[];
  ambiguousIds: number[];
  matchedPlayerIds: number[];
  matchedPspIds: number[];
}

/**
 * Load a company's imported transactions and persist the deterministic
 * reconciliation outcome (matches + ambiguous flags). Idempotent: re-running
 * recomputes and replaces the previous result for the same company.
 */
export async function runAndPersistReconciliation(
  companyId: number
): Promise<ReconciliationResult> {
  const db = getDb();
  const ledger = await loadIndexed(db, companyId, "player_ledger");
  const psp = await loadIndexed(db, companyId, "psp_transactions");
  const { matches, ambiguousIds } = runReconciliation(ledger, psp);

  await db.transaction(async (tx) => {
    // Reset prior state so results stay deterministic and idempotent.
    await tx
      .delete(reconciliationMatches)
      .where(eq(reconciliationMatches.companyId, companyId));
    await tx
      .update(reconciliationTransactions)
      .set({ matchStatus: "unmatched" })
      .where(eq(reconciliationTransactions.companyId, companyId));

    if (matches.length > 0) {
      await tx
        .insert(reconciliationMatches)
        .values(
          matches.map((m) => ({
            companyId,
            playerTransactionId: m.playerTransactionId,
            pspTransactionId: m.pspTransactionId,
          }))
        );
    }

    if (ambiguousIds.length > 0) {
      await tx
        .update(reconciliationTransactions)
        .set({ matchStatus: "ambiguous" })
        .where(
          and(
            eq(reconciliationTransactions.companyId, companyId),
            sql`${reconciliationTransactions.id} = ANY(${sql.param(ambiguousIds)})`
          )
        );
    }

    const matchedIds = matches.flatMap((m) => [m.playerTransactionId, m.pspTransactionId]);
    if (matchedIds.length > 0) {
      await tx
        .update(reconciliationTransactions)
        .set({ matchStatus: "matched" })
        .where(
          and(
            eq(reconciliationTransactions.companyId, companyId),
            sql`${reconciliationTransactions.id} = ANY(${sql.param(matchedIds)})`
          )
        );
    }
  });

  return {
    matches,
    ambiguousIds,
    matchedPlayerIds: matches.map((m) => m.playerTransactionId),
    matchedPspIds: matches.map((m) => m.pspTransactionId),
  };
}

async function loadIndexed(
  db: Db,
  companyId: number,
  source: ReconciliationSource
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
    })
    .from(reconciliationTransactions)
    .where(
      and(
        eq(reconciliationTransactions.companyId, companyId),
        eq(reconciliationTransactions.source, source)
      )
    )
    .orderBy(reconciliationTransactions.id);

  return rows.map((r) => ({
    id: r.id,
    companyId: r.companyId,
    source: r.source as ReconciliationSource,
    externalId: r.externalId,
    reference: r.reference,
    playerId: r.playerId,
    transactionType: r.transactionType,
    amount: String(r.amount),
    currency: r.currency,
  }));
}