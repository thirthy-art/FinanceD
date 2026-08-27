import { Decimal } from "@/src/lib/decimal";
import type { MatchPair } from "./types";

/**
 * Deterministic client-funds / PSP matching.
 *
 * A player-ledger transaction and a PSP transaction auto-match ONLY when ALL
 * of the following hold:
 *   - a matching normalized external/reference identifier across the sources;
 *   - an equivalent transaction direction (player deposit ↔ PSP deposit/capture,
 *     player withdrawal ↔ PSP withdrawal/payout);
 *   - exactly the same currency;
 *   - exactly the same amount;
 *   - terminal-success source statuses, unless that source file had no status column.
 *
 * If more than one candidate would satisfy the rules, no auto-match is made
 * and the involved transactions are flagged ambiguous. The engine never
 * guesses and never uses fuzzy/AI matching.
 */

export type TransactionDirection = "deposit" | "withdrawal";

export interface IndexedTransaction {
  id: number;
  companyId: number;
  source: "player_ledger" | "psp_transactions";
  externalId: string | null;
  reference: string | null;
  playerId: string | null;
  transactionType: TransactionDirection;
  amount: string;
  currency: string;
  status: string | null;
  statusProvided: boolean;
}

export interface MatchCandidate {
  playerId: number;
  pspId: number;
  reason: string;
}

export interface ReconciliationOutcome {
  matches: MatchPair[];
  /** Transaction ids that had ambiguous candidates and were NOT auto-matched. */
  ambiguousIds: number[];
}

export function normalizeId(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().replace(/\s+/g, "").toLowerCase();
  return normalized === "" ? null : normalized;
}

export function isCompatibleDirection(
  playerType: TransactionDirection,
  pspType: TransactionDirection
): boolean {
  // A player deposit is funded by a PSP deposit (capture); a player withdrawal
  // is paid out by a PSP withdrawal (payout).
  return playerType === pspType;
}

/** Exact decimal equality without floating-point arithmetic. */
export function amountsEqual(a: string, b: string): boolean {
  try {
    return new Decimal(a).eq(new Decimal(b));
  } catch {
    return false;
  }
}

/**
 * Only transaction/reference identifiers can authorize an automatic match.
 * playerId is deliberately excluded because it identifies an account, not a
 * unique payment event.
 */
function identifierValues(tx: {
  externalId: string | null;
  reference: string | null;
}): Array<{ value: string; label: string }> {
  const values: Array<{ value: string | null; label: string }> = [
    { value: normalizeId(tx.externalId), label: "external id" },
    { value: normalizeId(tx.reference), label: "reference" },
  ];
  return values.filter((entry): entry is { value: string; label: string } => entry.value !== null);
}

const SUCCESSFUL_PSP_STATUSES = new Set([
  "settled", "success", "successful", "completed", "captured", "paid", "approved",
]);

const SUCCESSFUL_PLAYER_LEDGER_STATUSES = new Set([
  "completed", "complete", "success", "successful", "approved", "processed", "settled", "paid",
]);

// When a status column exists, every value outside its source's success set is
// ineligible—including failed, declined, rejected, cancelled/canceled,
// pending, processing, reversed, void/voided, blank and unknown values.

function hasEligibleStatus(
  tx: Pick<IndexedTransaction, "status" | "statusProvided">,
  successfulStatuses: ReadonlySet<string>
): boolean {
  if (!tx.statusProvided) return true;
  const normalized = tx.status?.trim().toLowerCase() ?? "";
  return successfulStatuses.has(normalized);
}

/**
 * PSP rows are eligible only with a recognized terminal-success status. The
 * sole conservative exception is a file that had no status column at all.
 */
export function isPspStatusEligible(
  tx: Pick<IndexedTransaction, "status" | "statusProvided">
): boolean {
  return hasEligibleStatus(tx, SUCCESSFUL_PSP_STATUSES);
}

/**
 * Player-ledger rows follow the same conservative status-column policy: only
 * recognized final-success values are eligible when the column exists.
 */
export function isPlayerLedgerStatusEligible(
  tx: Pick<IndexedTransaction, "status" | "statusProvided">
): boolean {
  return hasEligibleStatus(tx, SUCCESSFUL_PLAYER_LEDGER_STATUSES);
}

/**
 * Compute all candidate (player, psp) pairs that satisfy the exact-match
 * rules. Matching compares external id / merchant reference on
 * both sides; amount, currency and direction must all agree exactly. Used by
 * the engine and by focused tests.
 */
export function findMatchCandidates(
  ledger: IndexedTransaction[],
  psp: IndexedTransaction[]
): MatchCandidate[] {
  // Index every PSP transaction under each of its identifier values.
  const pspIndex = new Map<string, Array<{ tx: IndexedTransaction; label: string }>>();
  for (const tx of psp) {
    if (!isPspStatusEligible(tx)) continue;
    for (const { value, label } of identifierValues(tx)) {
      if (!pspIndex.has(value)) pspIndex.set(value, []);
      pspIndex.get(value)!.push({ tx, label });
    }
  }

  const candidates: MatchCandidate[] = [];
  const seen = new Set<string>();
  for (const player of ledger) {
    if (!isPlayerLedgerStatusEligible(player)) continue;
    for (const { value, label } of identifierValues(player)) {
      const potential = pspIndex.get(value) ?? [];
      for (const { tx: pspTx, label: pspLabel } of potential) {
        if (!amountsEqual(player.amount, pspTx.amount)) continue;
        if (player.currency.toUpperCase() !== pspTx.currency.toUpperCase()) continue;
        if (!isCompatibleDirection(player.transactionType, pspTx.transactionType)) continue;
        const key = `${player.id}:${pspTx.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push({
          playerId: player.id,
          pspId: pspTx.id,
          reason: `${label} ↔ ${pspLabel}`,
        });
      }
    }
  }
  return candidates;
}

/**
 * Core deterministic match reduction.
 *
 * A candidate is auto-matched only when it can be paired one-to-one with an
 * available counterpart. If a transaction has multiple candidate partners the
 * whole conflicting group is declared ambiguous and nothing in that group is
 * auto-matched. Iteration order is deterministic (ascending ids) so results
 * are reproducible and idempotent.
 */
export function runDeterministicReconciliation(
  ledger: IndexedTransaction[],
  psp: IndexedTransaction[]
): { matches: MatchPair[]; ambiguousIds: number[] } {
  // Group candidate partners per transaction id.
  const playerIdPartners = new Map<number, MatchCandidate[]>();
  const pspIdPartners = new Map<number, MatchCandidate[]>();
  const pushPartner = (
    map: Map<number, MatchCandidate[]>,
    id: number,
    candidate: MatchCandidate
  ) => {
    const list = map.get(id) ?? [];
    list.push(candidate);
    map.set(id, list);
  };

  const candidates = findMatchCandidates(ledger, psp).sort(
    (a, b) => a.playerId - b.playerId || a.pspId - b.pspId
  );
  for (const candidate of candidates) {
    pushPartner(playerIdPartners, candidate.playerId, candidate);
    pushPartner(pspIdPartners, candidate.pspId, candidate);
  }

  // Any transaction with more than one distinct partner is ambiguous. A player
  // or psp transaction is only safe to auto-match when it has exactly one
  // candidate partner AND that partner likewise has exactly this one candidate.
  const ambiguousIds = new Set<number>();
  for (const [playerId, partners] of playerIdPartners) {
    if (partners.length > 1) {
      ambiguousIds.add(playerId);
      for (const partner of partners) ambiguousIds.add(partner.pspId);
    }
  }
  for (const [pspId, partners] of pspIdPartners) {
    if (partners.length > 1) {
      ambiguousIds.add(pspId);
      for (const partner of partners) ambiguousIds.add(partner.playerId);
    }
  }

  const usedPlayers = new Set<number>();
  const usedPsp = new Set<number>();
  const matches: MatchPair[] = [];
  for (const candidate of candidates) {
    if (ambiguousIds.has(candidate.playerId) || ambiguousIds.has(candidate.pspId)) continue;
    if (usedPlayers.has(candidate.playerId) || usedPsp.has(candidate.pspId)) continue;
    usedPlayers.add(candidate.playerId);
    usedPsp.add(candidate.pspId);
    matches.push({
      playerTransactionId: candidate.playerId,
      pspTransactionId: candidate.pspId,
      matchedOn: candidate.reason,
    });
  }

  return { matches, ambiguousIds: [...ambiguousIds] };
}

/**
 * Full match pipeline for a company's indexed transactions.
 */
export function runReconciliation(
  ledger: IndexedTransaction[],
  psp: IndexedTransaction[]
): ReconciliationOutcome {
  const result = runDeterministicReconciliation(ledger, psp);
  return { matches: result.matches, ambiguousIds: result.ambiguousIds };
}
