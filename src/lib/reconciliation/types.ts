/**
 * Client Funds / PSP Reconciliation — canonical model.
 *
 * This module is a deterministic foundation. Imported source transactions are
 * kept separate and independently identifiable; the match table records links
 * explicitly. Amounts are always decimal strings (never JS floating-point).
 */

export type ReconciliationSource = "player_ledger" | "psp_transactions";
export type ReconciliationTransactionType = "deposit" | "withdrawal";
export type MatchStatus = "matched" | "unmatched" | "ambiguous";

export interface ReconciliationTransaction {
  source: ReconciliationSource;
  /** External/provider-side identifier or merchant reference when present. */
  externalId: string | null;
  /** Retained player identifier when present (player ledger only). */
  playerId: string | null;
  transactionType: ReconciliationTransactionType;
  /** Amount as a canonical decimal string. */
  amount: string;
  currency: string;
  /** ISO date (YYYY-MM-DD) when present. */
  eventDate: string | null;
  reference: string | null;
  status: string | null;
  /** True when the source file included a status column, even if this row was blank. */
  statusProvided: boolean;
}

export interface MatchPair {
  playerTransactionId: number;
  pspTransactionId: number;
  matchedOn: string;
}

export interface MatchResult {
  /** Successful one-to-one exact matches. */
  pairs: MatchPair[];
  /** Transaction ids that had ambiguous candidates and were NOT auto-matched. */
  ambiguousIds: number[];
}

export const SOURCE_LABEL: Record<ReconciliationSource, string> = {
  player_ledger: "Player Ledger",
  psp_transactions: "PSP Transactions",
};
