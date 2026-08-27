import { Decimal } from "@/src/lib/decimal";
import type { ReconciliationTransaction } from "./types";
import { isPspStatusEligible } from "./match";

/**
 * Client Funds coverage summary.
 *
 * This is a product/demo reconciliation control, NOT a claim of MGA/legal
 * regulatory compliance. No jurisdiction-specific regulatory rule is applied.
 *
 * Documented simple rules for the v1 fixture/demo datasets:
 *   - Player liability: sum of net player-ledger obligations — the total of
 *     player-ledger deposits (funds received for players) minus the total of
 *     player-ledger withdrawals (funds paid out to players).
 *   - Available client/PSP funds: sum of all PSP deposit transactions (money
 *     held for the client) minus all PSP withdrawal/payout transactions.
 *
 * Both sides are summed per currency. Because the imported demo data is
 * expected to be single-currency, the primary displayed totals and the
 * surplus/shortfall are reported in that single common currency. When the
 * datasets contain more than one currency, each currency is still totalled,
 * but the coverage percentage is left as "—" (not applicable) rather than
 * mixing currencies without a conversion layer.
 */

export interface CoverageTotal {
  currency: string;
  total: string;
}

export interface CoverageSummary {
  playerLiability: string; // decimal string in the primary currency
  availableFunds: string;
  surplusOrShortfall: string | null;
  coveragePercent: string | null;
  currency: string | null;
  multiCurrency: boolean;
  playerTotals: CoverageTotal[];
  pspTotals: CoverageTotal[];
}

export type CoverageDifferenceKind = "surplus" | "shortfall" | "balanced" | "unavailable";

export function coverageDifferenceKind(value: string | null): CoverageDifferenceKind {
  if (value === null) return "unavailable";
  const comparison = new Decimal(value).comparedTo(0);
  if (comparison > 0) return "surplus";
  if (comparison < 0) return "shortfall";
  return "balanced";
}

function sumByCurrency(
  transactions: Array<{ amount: string | number; currency: string }>
): Map<string, Decimal> {
  const totals = new Map<string, Decimal>();
  for (const tx of transactions) {
    const amount = new Decimal(String(tx.amount));
    const key = tx.currency.toUpperCase();
    totals.set(key, (totals.get(key) ?? new Decimal(0)).plus(amount));
  }
  return totals;
}

/** Positive = surplus, negative = shortfall (in the primary currency). */
export function computeCoverage(
  ledger: ReconciliationTransaction[],
  psp: ReconciliationTransaction[]
): CoverageSummary {
  const playerDeposits = ledger.filter((tx) => tx.transactionType === "deposit");
  const playerWithdrawals = ledger.filter((tx) => tx.transactionType === "withdrawal");
  const eligiblePsp = psp.filter((tx) =>
    isPspStatusEligible({ status: tx.status, statusProvided: tx.statusProvided })
  );
  const pspDeposits = eligiblePsp.filter((tx) => tx.transactionType === "deposit");
  const pspWithdrawals = eligiblePsp.filter((tx) => tx.transactionType === "withdrawal");

  const playerNet = sumByCurrency([...playerDeposits, ...playerWithdrawals.map((tx) => ({ amount: `-${tx.amount}`, currency: tx.currency }))]);
  const pspNet = sumByCurrency([...pspDeposits, ...pspWithdrawals.map((tx) => ({ amount: `-${tx.amount}`, currency: tx.currency }))]);

  const allCurrencies = [...new Set([...playerNet.keys(), ...pspNet.keys()])];
  const multiCurrency = allCurrencies.length > 1;

  const currency = allCurrencies[0] ?? null;
  const playerLiability = currency ? playerNet.get(currency) ?? new Decimal(0) : new Decimal(0);
  const availableFunds = currency ? pspNet.get(currency) ?? new Decimal(0) : new Decimal(0);

  let surplusOrShortfall: string | null = null;
  let coveragePercent: string | null = null;
  if (currency && !multiCurrency) {
    surplusOrShortfall = availableFunds.minus(playerLiability).toString();
    if (playerLiability.gt(new Decimal(0))) {
      coveragePercent = availableFunds
        .dividedBy(playerLiability)
        .mul(100)
        .toDecimalPlaces(1)
        .toString();
    } else if (playerLiability.isZero()) {
      coveragePercent = availableFunds.isZero() ? "0.0" : "100.0";
    } else {
      coveragePercent = "0.0";
    }
  }

  return {
    playerLiability: playerLiability.toString(),
    availableFunds: availableFunds.toString(),
    surplusOrShortfall,
    coveragePercent,
    currency,
    multiCurrency,
    playerTotals: [...playerNet.entries()].map(([c, d]) => ({ currency: c, total: d.toString() })),
    pspTotals: [...pspNet.entries()].map(([c, d]) => ({ currency: c, total: d.toString() })),
  };
}
