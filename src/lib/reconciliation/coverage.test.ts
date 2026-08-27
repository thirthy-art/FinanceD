import { describe, expect, it } from "vitest";
import { computeCoverage, coverageDifferenceKind } from "./coverage";
import { parseReconciliationCsv } from "./import";
import type { ReconciliationTransaction } from "./types";

function tx(partial: Partial<ReconciliationTransaction>): ReconciliationTransaction {
  return {
    source: "player_ledger",
    externalId: null,
    playerId: null,
    transactionType: "deposit",
    amount: "0",
    currency: "EUR",
    eventDate: null,
    reference: null,
    status: null,
    statusProvided: false,
    ...partial,
  };
}

describe("computeCoverage", () => {
  it("computes player liability as net player-ledger deposits minus withdrawals", () => {
    const ledger = [
      tx({ transactionType: "deposit", amount: "1000.00" }),
      tx({ transactionType: "withdrawal", amount: "200.00" }),
    ];
    const psp = [
      tx({ source: "psp_transactions", transactionType: "deposit", amount: "1000.00" }),
      tx({ source: "psp_transactions", transactionType: "withdrawal", amount: "200.00" }),
    ];
    const summary = computeCoverage(ledger, psp);
    expect(summary.playerLiability).toBe("800");
    expect(summary.availableFunds).toBe("800");
    expect(summary.surplusOrShortfall).toBe("0");
    expect(summary.coveragePercent).toBe("100");
    expect(summary.currency).toBe("EUR");
  });

  it("reports a surplus when available funds exceed player liabilities", () => {
    const ledger = [tx({ transactionType: "deposit", amount: "500.00" })];
    const psp = [tx({ source: "psp_transactions", transactionType: "deposit", amount: "750.00" })];
    const summary = computeCoverage(ledger, psp);
    expect(summary.playerLiability).toBe("500");
    expect(summary.availableFunds).toBe("750");
    expect(summary.surplusOrShortfall).toBe("250");
    expect(summary.coveragePercent).toBe("150");
  });

  it("reports a shortfall when available funds are below player liabilities", () => {
    const ledger = [tx({ transactionType: "deposit", amount: "1000.00" })];
    const psp = [tx({ source: "psp_transactions", transactionType: "deposit", amount: "600.00" })];
    const summary = computeCoverage(ledger, psp);
    expect(summary.playerLiability).toBe("1000");
    expect(summary.availableFunds).toBe("600");
    expect(summary.surplusOrShortfall).toBe("-400");
    expect(summary.coveragePercent).toBe("60");
  });

  it("marks multi-currency datasets and returns not-applicable percentage", () => {
    const ledger = [
      tx({ transactionType: "deposit", amount: "100.00", currency: "EUR" }),
      tx({ transactionType: "deposit", amount: "50.00", currency: "USD" }),
    ];
    const psp = [tx({ source: "psp_transactions", transactionType: "deposit", amount: "100.00", currency: "EUR" })];
    const summary = computeCoverage(ledger, psp);
    expect(summary.multiCurrency).toBe(true);
    expect(summary.coveragePercent).toBeNull();
  });

  it("remains correct when signed source amounts are normalized to magnitudes", () => {
    const ledger = parseReconciliationCsv(
      "player_ledger",
      "transaction_id,type,amount,currency\nD-1,deposit,-100,EUR\nW-1,withdrawal,-40,EUR"
    ).transactions;
    const psp = parseReconciliationCsv(
      "psp_transactions",
      "psp_id,type,amount,currency\nP-1,deposit,-100,EUR\nP-2,withdrawal,-40,EUR"
    ).transactions;
    expect(computeCoverage(ledger, psp)).toMatchObject({
      playerLiability: "60",
      availableFunds: "60",
      surplusOrShortfall: "0",
    });
  });

  it("classifies a zero difference as balanced, not shortfall", () => {
    expect(coverageDifferenceKind("0")).toBe("balanced");
    expect(coverageDifferenceKind("0.0000")).toBe("balanced");
  });
});
