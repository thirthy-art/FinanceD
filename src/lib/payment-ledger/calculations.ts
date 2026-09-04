import { Decimal } from "@/src/lib/decimal";
import type { AccountAssetOpening, FeeRule, PaymentEvent, ReportedBalanceSnapshot, ReserveRule } from "./types";
import type { IndexedTransaction } from "@/src/lib/reconciliation/match";

const zero = () => new Decimal(0);
const keyOf = (accountId: number, asset: string) => `${accountId}:${asset.toUpperCase()}`;

export interface BalancePosition {
  paymentAccountId: number;
  assetCode: string;
  assetType: "fiat" | "crypto";
  available: string;
  reserve: string;
  totalOwned: string;
  reportedAvailable: string | null;
  reportedReserve: string | null;
  availableDifference: string | null;
  reserveDifference: string | null;
}

export function calculateBalances(openings: AccountAssetOpening[], events: PaymentEvent[], snapshots: ReportedBalanceSnapshot[] = []): BalancePosition[] {
  const positions = new Map<string, { accountId: number; asset: string; type: "fiat" | "crypto"; available: Decimal; reserve: Decimal; reportedAvailable: string | null; reportedReserve: string | null }>();
  const ensure = (accountId: number, asset: string, type: "fiat" | "crypto") => {
    const key = keyOf(accountId, asset);
    let position = positions.get(key);
    if (!position) {
      position = { accountId, asset: asset.toUpperCase(), type, available: zero(), reserve: zero(), reportedAvailable: null, reportedReserve: null };
      positions.set(key, position);
    }
    return position;
  };
  for (const opening of openings) {
    const position = ensure(opening.paymentAccountId, opening.assetCode, opening.assetType);
    position.available = new Decimal(opening.openingAvailableBalance);
    position.reserve = new Decimal(opening.openingReserveBalance);
  }
  const ordered = [...events].sort((a, b) => a.eventDate.localeCompare(b.eventDate) || a.id - b.id);
  for (const event of ordered) {
    const position = ensure(event.paymentAccountId, event.balanceAssetCode, event.balanceAssetType);
    const opening = openings.find((candidate) => candidate.paymentAccountId === event.paymentAccountId && candidate.assetCode.toUpperCase() === event.balanceAssetCode.toUpperCase());
    if (opening?.openingBalanceDate && event.eventDate < opening.openingBalanceDate) continue;
    const amount = new Decimal(event.balanceAmount);
    if (event.eventType === "reserve_hold") {
      position.available = position.available.minus(amount);
      position.reserve = position.reserve.plus(amount);
    } else if (event.eventType === "reserve_release") {
      position.reserve = position.reserve.minus(amount);
      position.available = position.available.plus(amount);
    } else if (event.balanceDirection === "credit") {
      position.available = position.available.plus(amount);
    } else if (event.balanceDirection === "debit") {
      position.available = position.available.minus(amount);
    }
    if (event.reportedAvailableBalance !== null) position.reportedAvailable = event.reportedAvailableBalance;
    if (event.reportedReserveBalance !== null) position.reportedReserve = event.reportedReserveBalance;
  }
  const latestSnapshots = new Map<string, ReportedBalanceSnapshot>();
  for (const snapshot of snapshots) {
    const key = keyOf(snapshot.paymentAccountId, snapshot.assetCode); const current = latestSnapshots.get(key);
    if (!current || snapshot.asOf > current.asOf) latestSnapshots.set(key, snapshot);
  }
  for (const snapshot of latestSnapshots.values()) {
    const position = ensure(snapshot.paymentAccountId, snapshot.assetCode, snapshot.assetType);
    position.reportedAvailable = snapshot.reportedAvailableBalance;
    position.reportedReserve = snapshot.reportedReserveBalance;
  }
  return [...positions.values()].map((position) => ({
    paymentAccountId: position.accountId,
    assetCode: position.asset,
    assetType: position.type,
    available: position.available.toFixed(),
    reserve: position.reserve.toFixed(),
    totalOwned: position.available.plus(position.reserve).toFixed(),
    reportedAvailable: position.reportedAvailable,
    reportedReserve: position.reportedReserve,
    availableDifference: position.reportedAvailable === null ? null : position.available.minus(position.reportedAvailable).toFixed(),
    reserveDifference: position.reportedReserve === null ? null : position.reserve.minus(position.reportedReserve).toFixed(),
  }));
}

export function impliedFx(sourceAmount: string | null, targetAmount: string | null): string | null {
  if (sourceAmount === null || targetAmount === null) return null;
  const source = new Decimal(sourceAmount);
  if (source.isZero()) return null;
  return new Decimal(targetAmount).div(source).toFixed();
}

export function fxVariance(sourceAmount: string | null, actualTargetAmount: string | null, expectedRate: string | null): { expectedTargetAmount: string; variance: string } | null {
  if (sourceAmount === null || actualTargetAmount === null || expectedRate === null) return null;
  const expectedTargetAmount = new Decimal(sourceAmount).times(expectedRate);
  return { expectedTargetAmount: expectedTargetAmount.toFixed(), variance: new Decimal(actualTargetAmount).minus(expectedTargetAmount).toFixed() };
}

function activeOn(date: string, from: string, to: string | null) {
  return date >= from && (to === null || date <= to);
}

function applicableFeeRules(event: PaymentEvent, rules: FeeRule[]) {
  return rules.filter((candidate) => {
    const basisAsset = candidate.feeBasis === "source_amount" ? event.sourceAssetCode : event.balanceAssetCode;
    return basisAsset !== null &&
    candidate.paymentAccountId === event.paymentAccountId &&
    candidate.eventType === event.eventType &&
    (candidate.assetCode === null || candidate.assetCode.toUpperCase() === basisAsset.toUpperCase()) &&
    activeOn(event.eventDate, candidate.effectiveFrom, candidate.effectiveTo);
  });
}

export function expectedFee(event: PaymentEvent, rules: FeeRule[]): string | null {
  const matches = applicableFeeRules(event, rules);
  if (matches.length !== 1) return null;
  const rule = matches[0];
  const basisAmount = rule.feeBasis === "source_amount" ? event.sourceAmount : event.balanceAmount;
  const basisAsset = rule.feeBasis === "source_amount" ? event.sourceAssetCode : event.balanceAssetCode;
  const feeAsset = (rule.feeAssetCode ?? rule.fixedAssetCode ?? basisAsset)?.toUpperCase() ?? null;
  if (basisAmount === null || basisAsset === null || feeAsset !== basisAsset.toUpperCase()) return null;
  return new Decimal(basisAmount).times(rule.percentageRate).div(100).plus(rule.fixedAmount).toFixed();
}

export function feeVariance(event: PaymentEvent, rules: FeeRule[]): string | null {
  const expected = expectedFee(event, rules);
  if (expected === null || event.actualFeeAmount === null || event.actualFeeAssetCode === null) return null;
  const matches = applicableFeeRules(event, rules);
  if (matches.length !== 1) return null;
  const basisAsset = matches[0].feeBasis === "source_amount" ? event.sourceAssetCode : event.balanceAssetCode;
  if (event.actualFeeAssetCode.toUpperCase() !== (matches[0].feeAssetCode ?? matches[0].fixedAssetCode ?? basisAsset)?.toUpperCase()) return null;
  return new Decimal(event.actualFeeAmount).minus(expected).toFixed();
}

export function expectedReserveReleaseDate(event: PaymentEvent, rules: ReserveRule[]): string | null {
  if (event.eventType !== "reserve_hold") return null;
  if (event.expectedReleaseDate) return event.expectedReleaseDate;
  const rule = rules.find((candidate) =>
    candidate.paymentAccountId === event.paymentAccountId &&
    (candidate.assetCode === null || candidate.assetCode.toUpperCase() === event.balanceAssetCode.toUpperCase()) &&
    activeOn(event.eventDate, candidate.effectiveFrom, candidate.effectiveTo) &&
    candidate.holdPeriodDays !== null
  );
  if (rule?.holdPeriodDays === null || rule === undefined) return null;
  const date = new Date(`${event.eventDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + rule.holdPeriodDays);
  return date.toISOString().slice(0, 10);
}

export interface TransitPosition { sourceEventId: number; sourceAccountId: number; destinationAccountId: number | null; sourceAssetCode: string; sourceAmount: string; outstandingAmount: string; }
export function calculateFundsInTransit(events: PaymentEvent[]): TransitPosition[] {
  return events
    .filter((event) => (event.eventType === "settlement" || event.eventType === "transfer") && event.balanceDirection === "debit")
    .map((event) => {
      const relatedReceipts = events.filter((receipt) => receipt.relatedEventId === event.id);
      const crossAssetReceipt = relatedReceipts.some((receipt) => receipt.balanceAssetCode.toUpperCase() !== event.balanceAssetCode.toUpperCase());
      const received = crossAssetReceipt
        ? (relatedReceipts.some((receipt) => receipt.finalReceipt) ? new Decimal(event.balanceAmount) : zero())
        : relatedReceipts.reduce((sum, receipt) => sum.plus(receipt.balanceAmount), zero());
      const outstanding = new Decimal(event.balanceAmount).minus(received);
      return { sourceEventId: event.id, sourceAccountId: event.paymentAccountId, destinationAccountId: event.destinationAccountId, sourceAssetCode: event.balanceAssetCode, sourceAmount: event.balanceAmount, outstandingAmount: Decimal.max(outstanding, 0).toFixed() };
    })
    .filter((position) => !new Decimal(position.outstandingAmount).isZero());
}

export interface ReserveLot { id: number; paymentAccountId: number; assetCode: string; holdDate: string; amount: string; expectedReleaseDate: string | null; released: string; actualReleaseDate: string | null; outstanding: string; }
export function calculateReserveLots(events: PaymentEvent[], rules: ReserveRule[]): ReserveLot[] {
  return events.filter((event) => event.eventType === "reserve_hold").map((hold) => {
    const releases = events.filter((event) => event.eventType === "reserve_release" && event.relatedEventId === hold.id);
    const released = releases.reduce((sum, event) => sum.plus(event.balanceAmount), zero());
    return { id: hold.id, paymentAccountId: hold.paymentAccountId, assetCode: hold.balanceAssetCode, holdDate: hold.eventDate, amount: hold.balanceAmount, expectedReleaseDate: expectedReserveReleaseDate(hold, rules), released: released.toFixed(), actualReleaseDate: releases.at(-1)?.eventDate ?? null, outstanding: Decimal.max(new Decimal(hold.balanceAmount).minus(released), 0).toFixed() };
  });
}

export function groupOwnedFundsByAsset(positions: BalancePosition[], transit: TransitPosition[]) {
  const grouped = new Map<string, { assetCode: string; available: Decimal; reserve: Decimal; transit: Decimal; totalOwned: Decimal }>();
  const ensure = (asset: string) => {
    const code = asset.toUpperCase();
    let row = grouped.get(code);
    if (!row) { row = { assetCode: code, available: zero(), reserve: zero(), transit: zero(), totalOwned: zero() }; grouped.set(code, row); }
    return row;
  };
  for (const position of positions) { const row = ensure(position.assetCode); row.available = row.available.plus(position.available); row.reserve = row.reserve.plus(position.reserve); }
  for (const item of transit) { const row = ensure(item.sourceAssetCode); row.transit = row.transit.plus(item.outstandingAmount); }
  return [...grouped.values()].map((row) => ({ assetCode: row.assetCode, immediatelyAvailable: row.available.toFixed(), rollingReserve: row.reserve.toFixed(), fundsInTransit: row.transit.toFixed(), totalOwned: row.available.plus(row.reserve).plus(row.transit).toFixed() }));
}

export interface ProcessedVolumeCorridor { corridor: string; sourceAssetCode: string; balanceAssetCode: string; volume: string; }
export function calculateProcessedVolumeCorridors(events: PaymentEvent[]): ProcessedVolumeCorridor[] {
  const grouped = new Map<string, { source: string; target: string; volume: Decimal }>();
  for (const event of events) {
    if (event.eventType !== "deposit" && event.eventType !== "withdrawal") continue;
    const source = (event.sourceAssetCode ?? event.balanceAssetCode).toUpperCase(); const target = event.balanceAssetCode.toUpperCase();
    const corridor = source === target ? source : `${source} → ${target}`;
    const row = grouped.get(corridor) ?? { source, target, volume: zero() };
    row.volume = row.volume.plus(event.sourceAmount ?? event.balanceAmount); grouped.set(corridor, row);
  }
  return [...grouped].map(([corridor, row]) => ({ corridor, sourceAssetCode: row.source, balanceAssetCode: row.target, volume: row.volume.toFixed() }));
}

/** Only player-facing deposits/withdrawals enter Client Funds matching. */
export function toReconciliationCandidate(event: Pick<PaymentEvent, "id" | "companyId" | "eventType" | "externalId" | "reference" | "sourceAmount" | "balanceAmount" | "sourceAssetCode" | "balanceAssetCode" | "status" | "statusProvided">): IndexedTransaction | null {
  if (event.eventType !== "deposit" && event.eventType !== "withdrawal") return null;
  return {
    id: -event.id, companyId: event.companyId, source: "psp_transactions", externalId: event.externalId,
    reference: event.reference, playerId: null, transactionType: event.eventType,
    amount: event.sourceAmount ?? event.balanceAmount, currency: event.sourceAssetCode ?? event.balanceAssetCode,
    status: event.status, statusProvided: event.statusProvided,
  };
}

/** Provider cost in one target asset; liquidity exposures are deliberately not inputs. */
export function providerCostImpact(actualFee: string | null, feeAsset: string | null, fxVarianceValue: string | null, targetAsset: string): string | null {
  const comparableFee = actualFee !== null && feeAsset?.toUpperCase() === targetAsset.toUpperCase() ? new Decimal(actualFee) : null;
  const adverseFx = fxVarianceValue === null ? null : Decimal.max(new Decimal(fxVarianceValue).negated(), 0);
  if (comparableFee === null && adverseFx === null) return null;
  return (comparableFee ?? zero()).plus(adverseFx ?? zero()).toFixed();
}
