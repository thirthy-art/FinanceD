import { describe, expect, it } from "vitest";
import {
  findMatchCandidates,
  runDeterministicReconciliation,
  type IndexedTransaction,
} from "./match";

function ledgerTx(partial: Partial<IndexedTransaction>): IndexedTransaction {
  return {
    id: 0,
    companyId: 1,
    source: "player_ledger",
    externalId: null,
    reference: null,
    playerId: null,
    transactionType: "deposit",
    amount: "100.00",
    currency: "EUR",
    status: null,
    statusProvided: false,
    ...partial,
  };
}

function pspTx(partial: Partial<IndexedTransaction>): IndexedTransaction {
  return {
    id: 0,
    companyId: 1,
    source: "psp_transactions",
    externalId: null,
    reference: null,
    playerId: null,
    transactionType: "deposit",
    amount: "100.00",
    currency: "EUR",
    status: null,
    statusProvided: false,
    ...partial,
  };
}

describe("findMatchCandidates", () => {
  it("matches on shared external id when amount, currency and direction agree", () => {
    const candidates = findMatchCandidates(
      [ledgerTx({ id: 1, externalId: "REF-1", amount: "50.00", currency: "EUR", transactionType: "deposit" })],
      [pspTx({ id: 11, externalId: "ref-1", amount: "50", currency: "eur", transactionType: "deposit" })]
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ playerId: 1, pspId: 11 });
  });

  it("does not match when amounts differ", () => {
    const candidates = findMatchCandidates(
      [ledgerTx({ id: 1, externalId: "REF-1", amount: "50.00" })],
      [pspTx({ id: 11, externalId: "REF-1", amount: "60.00" })]
    );
    expect(candidates).toHaveLength(0);
  });

  it("does not match when currency differs", () => {
    const candidates = findMatchCandidates(
      [ledgerTx({ id: 1, externalId: "REF-1", currency: "EUR" })],
      [pspTx({ id: 11, externalId: "REF-1", currency: "USD" })]
    );
    expect(candidates).toHaveLength(0);
  });

  it("does not match incompatible transaction directions", () => {
    const candidates = findMatchCandidates(
      [ledgerTx({ id: 1, externalId: "REF-1", transactionType: "deposit" })],
      [pspTx({ id: 11, externalId: "REF-1", transactionType: "withdrawal" })]
    );
    expect(candidates).toHaveLength(0);
  });

  it("does not use player id alone as an automatic-match identifier", () => {
    const candidates = findMatchCandidates(
      [ledgerTx({ id: 1, externalId: null, playerId: "user-7", amount: "20.00" })],
      [pspTx({ id: 11, externalId: null, playerId: "USER-7", amount: "20.00" })]
    );
    expect(candidates).toHaveLength(0);
  });

  it("does not match a player id to a PSP external id", () => {
    const candidates = findMatchCandidates(
      [ledgerTx({ id: 1, playerId: "COLLISION" })],
      [pspTx({ id: 11, externalId: "COLLISION" })]
    );
    expect(candidates).toHaveLength(0);
  });

  it("matches a player external id to a PSP merchant reference", () => {
    const candidates = findMatchCandidates(
      [ledgerTx({ id: 1, externalId: "payment-7" })],
      [pspTx({ id: 11, externalId: "provider-9", reference: "PAYMENT-7" })]
    );
    expect(candidates).toEqual([
      { playerId: 1, pspId: 11, reason: "external id ↔ reference" },
    ]);
  });

  it.each(["failed", "pending", "declined", "processing", "reversed", "unknown"])(
    "does not match PSP status %s",
    (status) => {
      const candidates = findMatchCandidates(
        [ledgerTx({ id: 1, externalId: "REF-1" })],
        [pspTx({ id: 11, externalId: "REF-1", status, statusProvided: true })]
      );
      expect(candidates).toHaveLength(0);
    }
  );

  it.each(["settled", "success", "successful", "completed", "captured", "paid", "approved"])(
    "matches terminal-success PSP status %s",
    (status) => {
      const candidates = findMatchCandidates(
        [ledgerTx({ id: 1, externalId: "REF-1" })],
        [pspTx({ id: 11, externalId: "REF-1", status, statusProvided: true })]
      );
      expect(candidates).toHaveLength(1);
    }
  );

  it("does not match a blank status when the PSP file had a status column", () => {
    const candidates = findMatchCandidates(
      [ledgerTx({ id: 1, externalId: "REF-1" })],
      [pspTx({ id: 11, externalId: "REF-1", status: null, statusProvided: true })]
    );
    expect(candidates).toHaveLength(0);
  });
});

describe("runDeterministicReconciliation", () => {
  it("auto-matches a single unique exact pair", () => {
    const result = runDeterministicReconciliation(
      [ledgerTx({ id: 1, externalId: "A", amount: "100.00" })],
      [pspTx({ id: 2, externalId: "A", amount: "100.00" })]
    );
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({ playerTransactionId: 1, pspTransactionId: 2 });
    expect(result.ambiguousIds).toHaveLength(0);
  });

  it("marks ambiguous when multiple candidates satisfy the rule", () => {
    const result = runDeterministicReconciliation(
      [ledgerTx({ id: 1, externalId: "DUP", amount: "10.00" })],
      [
        pspTx({ id: 21, externalId: "DUP", amount: "10.00" }),
        pspTx({ id: 22, externalId: "DUP", amount: "10.00" }),
      ]
    );
    // a single ledger tx has two PSP candidates → no auto-match
    expect(result.matches).toHaveLength(0);
    expect(result.ambiguousIds).toContain(1);
    expect(result.ambiguousIds).toContain(21);
    expect(result.ambiguousIds).toContain(22);
  });

  it("never guesses: unmatched items stay unmatched", () => {
    const result = runDeterministicReconciliation(
      [ledgerTx({ id: 1, externalId: "ONLY-LEDGER", amount: "5.00" })],
      [pspTx({ id: 2, externalId: "ONLY-PSP", amount: "5.00" })]
    );
    expect(result.matches).toHaveLength(0);
    expect(result.ambiguousIds).toHaveLength(0);
  });
});
