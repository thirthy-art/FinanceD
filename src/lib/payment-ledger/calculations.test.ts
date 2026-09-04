import { describe, expect, it } from "vitest";
import { calculateBalances, calculateFundsInTransit, calculateProcessedVolumeCorridors, calculateReserveLots, expectedFee, expectedReserveReleaseDate, feeVariance, fxVariance, groupOwnedFundsByAsset, impliedFx, providerCostImpact, toReconciliationCandidate } from "./calculations";
import type { PaymentEvent } from "./types";

const event = (overrides: Partial<PaymentEvent> = {}): PaymentEvent => ({
  id: 1, companyId: 7, paymentAccountId: 10, importId: 20, sourceRowNumber: 2, sourceRowId: null, providerEventId: "provider-1", relatedProviderEventId: null,
  externalId: "tx-1", reference: "ref-1", eventDate: "2026-01-01", eventType: "deposit",
  balanceDirection: "credit", balanceAmount: "100", balanceAssetCode: "EUR", balanceAssetType: "fiat",
  sourceAmount: "100", sourceAssetCode: "EUR", sourceAssetType: "fiat", actualFeeAmount: null,
  actualFeeAssetCode: null, expectedFxRate: null, reportedAvailableBalance: null, reportedReserveBalance: null,
  expectedReleaseDate: null, destinationAccountId: null, destinationAmount: null, destinationAssetCode: null,
  destinationAssetType: null, expectedDestinationAmount: null, expectedDestinationRate: null, relatedEventId: null, finalReceipt: false,
  status: "settled", statusProvided: true, rawIdentifiers: null, ...overrides,
});
const opening = [{ paymentAccountId: 10, assetCode: "EUR", assetType: "fiat" as const, openingAvailableBalance: "1000", openingReserveBalance: "50", openingBalanceDate: null }];
const feeRule = (overrides = {}) => ({ paymentAccountId: 10, eventType: "deposit" as const, feeBasis: "source_amount" as const, assetCode: "EUR", feeAssetCode: "EUR", percentageRate: "2.5", fixedAmount: "1", fixedAssetCode: "EUR", effectiveFrom: "2025-01-01", effectiveTo: null, ...overrides });

describe("canonical payment-ledger calculations", () => {
  it("rolls available balance from opening and explicit economic effects", () => {
    const positions = calculateBalances(opening, [event({ balanceAmount: "200" }), event({ id: 2, eventType: "fee", balanceDirection: "debit", balanceAmount: "12" })]);
    expect(positions[0]).toMatchObject({ available: "1188", reserve: "50", totalOwned: "1238" });
  });

  it("moves reserve holds from available to reserve without reducing total owned", () => {
    const [position] = calculateBalances(opening, [event({ eventType: "reserve_hold", balanceDirection: "none", balanceAmount: "80" })]);
    expect(position.available).toBe("920"); expect(position.reserve).toBe("130"); expect(position.totalOwned).toBe("1050");
  });

  it("moves reserve releases back to available", () => {
    const [position] = calculateBalances(opening, [event({ eventType: "reserve_release", balanceDirection: "none", balanceAmount: "20" })]);
    expect(position.available).toBe("1020"); expect(position.reserve).toBe("30"); expect(position.totalOwned).toBe("1050");
  });

  it("keeps calculated and latest reported balances separate", () => {
    const [position] = calculateBalances(opening, [event({ balanceAmount: "100", reportedAvailableBalance: "1095" })]);
    expect(position.available).toBe("1100"); expect(position.reportedAvailable).toBe("1095"); expect(position.availableDifference).toBe("5");
  });

  it("honors opening balance date as immediately before that date", () => {
    const dated = [{ ...opening[0], openingBalanceDate: "2026-01-02" }];
    const [position] = calculateBalances(dated, [event({ eventDate: "2026-01-01", balanceAmount: "900" }), event({ id: 2, eventDate: "2026-01-02", balanceAmount: "25" })]);
    expect(position.available).toBe("1025");
    expect(calculateBalances(opening, [event({ eventDate: "2026-01-01", balanceAmount: "900" })])[0].available).toBe("1900");
  });

  it("uses the latest standalone reported snapshot without changing calculated balance", () => {
    const [position] = calculateBalances(opening, [event()], [
      { paymentAccountId: 10, assetCode: "EUR", assetType: "fiat", reportedAvailableBalance: "1090", reportedReserveBalance: "50", asOf: new Date("2026-01-02") },
      { paymentAccountId: 10, assetCode: "EUR", assetType: "fiat", reportedAvailableBalance: "1088", reportedReserveBalance: "49", asOf: new Date("2026-01-03") },
    ]);
    expect(position).toMatchObject({ available: "1100", reportedAvailable: "1088", availableDifference: "12" });
  });

  it("keeps stablecoin snapshots in their actual asset", () => {
    const [position] = calculateBalances([], [], [{ paymentAccountId: 10, assetCode: "USDC", assetType: "crypto", reportedAvailableBalance: "50", reportedReserveBalance: null, asOf: new Date() }]);
    expect(position).toMatchObject({ assetCode: "USDC", assetType: "crypto", reportedAvailable: "50" });
  });

  it("derives expected reserve release only from an explicit date or active rule", () => {
    const hold = event({ eventType: "reserve_hold", expectedReleaseDate: null });
    expect(expectedReserveReleaseDate(hold, [])).toBeNull();
    expect(expectedReserveReleaseDate(hold, [{ paymentAccountId: 10, assetCode: "EUR", holdPeriodDays: 30, effectiveFrom: "2025-01-01", effectiveTo: null }])).toBe("2026-01-31");
    expect(expectedReserveReleaseDate(hold, [{ paymentAccountId: 10, assetCode: "EUR", holdPeriodDays: 0, effectiveFrom: "2025-01-01", effectiveTo: null }])).toBe("2026-01-01");
    expect(expectedReserveReleaseDate({ ...hold, expectedReleaseDate: "2026-03-15" }, [])).toBe("2026-03-15");
  });

  it("allocates only explicitly linked reserve releases", () => {
    const holdA = event({ id: 10, eventType: "reserve_hold", balanceDirection: "none", balanceAmount: "80" });
    const holdB = event({ id: 11, providerEventId: "hold-b", eventType: "reserve_hold", balanceDirection: "none", balanceAmount: "80" });
    const linked = event({ id: 12, eventType: "reserve_release", balanceDirection: "none", balanceAmount: "30", relatedEventId: 11 });
    const unlinked = event({ id: 13, eventType: "reserve_release", balanceDirection: "none", balanceAmount: "20", relatedEventId: null });
    const lots = calculateReserveLots([holdA, holdB, linked, unlinked], []);
    expect(lots.find((lot) => lot.id === 10)?.released).toBe("0");
    expect(lots.find((lot) => lot.id === 11)).toMatchObject({ released: "30", outstanding: "50" });
  });

  it("creates and clears same-asset funds in transit", () => {
    const sent = event({ id: 5, eventType: "settlement", balanceDirection: "debit", balanceAmount: "80000", destinationAccountId: 11 });
    expect(calculateFundsInTransit([sent])[0].outstandingAmount).toBe("80000");
    const receipt = event({ id: 6, paymentAccountId: 11, eventType: "deposit", balanceAmount: "80000", relatedEventId: 5, destinationAmount: "80000", destinationAssetCode: "EUR", destinationAssetType: "fiat" });
    expect(calculateFundsInTransit([sent, receipt])).toEqual([]);
  });

  it("reduces same-asset transit with partial receipts", () => {
    const sent = event({ id: 5, eventType: "transfer", balanceDirection: "debit", balanceAmount: "80000" });
    const first = event({ id: 6, balanceAmount: "30000", relatedEventId: 5 });
    expect(calculateFundsInTransit([sent, first])[0].outstandingAmount).toBe("50000");
    const second = event({ id: 7, balanceAmount: "50000", relatedEventId: 5 });
    expect(calculateFundsInTransit([sent, first, second])).toEqual([]);
  });

  it("preserves multi-currency settlement source and destination assets", () => {
    const sent = event({ id: 5, eventType: "settlement", balanceDirection: "debit", balanceAmount: "80000", balanceAssetCode: "USD", destinationAmount: "68200", destinationAssetCode: "EUR", destinationAssetType: "fiat" });
    expect(calculateFundsInTransit([sent])[0]).toMatchObject({ sourceAssetCode: "USD", sourceAmount: "80000" });
    expect(impliedFx(sent.balanceAmount, sent.destinationAmount)).toBe("0.8525");
    const receipt = event({ id: 6, paymentAccountId: 11, balanceAmount: "68200", balanceAssetCode: "EUR", relatedEventId: 5, destinationAmount: "68200", destinationAssetCode: "EUR", destinationAssetType: "fiat" });
    expect(calculateFundsInTransit([sent, receipt])[0].outstandingAmount).toBe("80000");
    expect(calculateFundsInTransit([sent, { ...receipt, finalReceipt: true }])).toEqual([]);
  });

  it("uses target units per one source unit for actual FX", () => expect(impliedFx("1000", "852")).toBe("0.852"));
  it("calculates expected target and FX variance without guessing missing rates", () => {
    expect(fxVariance("1000", "852", "0.860")).toEqual({ expectedTargetAmount: "860", variance: "-8" });
    expect(fxVariance("1000", "852", null)).toBeNull();
  });

  it("calculates dated percentage plus fixed expected fee and actual-minus-expected variance", () => {
    const payment = event({ sourceAmount: "1000", actualFeeAmount: "27", actualFeeAssetCode: "EUR" });
    const rules = [feeRule()];
    expect(expectedFee(payment, rules)).toBe("26"); expect(feeVariance(payment, rules)).toBe("1");
  });

  it("returns unavailable when no fee rule exists or fee assets differ", () => {
    expect(expectedFee(event(), [])).toBeNull();
    const rules = [feeRule({ percentageRate: "1", fixedAmount: "0" })];
    expect(feeVariance(event({ actualFeeAmount: "1", actualFeeAssetCode: "USD" }), rules)).toBeNull();
  });

  it("supports balance-amount fees across a USD to EUR corridor", () => {
    const payment = event({ sourceAmount: "1000", sourceAssetCode: "USD", balanceAmount: "852", balanceAssetCode: "EUR", actualFeeAmount: "18", actualFeeAssetCode: "EUR" });
    const rules = [feeRule({ feeBasis: "balance_amount", percentageRate: "2", fixedAmount: "0.20" })];
    expect(expectedFee(payment, rules)).toBe("17.24");
    expect(feeVariance(payment, rules)).toBe("0.76");
  });

  it("returns unavailable for incomparable or ambiguous fee rules", () => {
    const payment = event({ sourceAmount: "1000", sourceAssetCode: "USD", balanceAssetCode: "EUR" });
    expect(expectedFee(payment, [feeRule({ assetCode: "USD", feeAssetCode: "EUR" })])).toBeNull();
    expect(expectedFee(event(), [feeRule(), feeRule({ percentageRate: "3" })])).toBeNull();
  });

  it("groups balances by actual asset without treating stablecoin as fiat", () => {
    const positions = calculateBalances([], [event({ balanceAssetCode: "EUR" }), event({ id: 2, balanceAssetCode: "USD" }), event({ id: 3, balanceAssetCode: "USDC", balanceAssetType: "crypto" }), event({ id: 4, balanceAssetCode: "BTC", balanceAssetType: "crypto" })]);
    expect(groupOwnedFundsByAsset(positions, []).map((row) => row.assetCode)).toEqual(["EUR", "USD", "USDC", "BTC"]);
  });

  it("admits only player-facing deposit and withdrawal events to Client Funds", () => {
    expect(toReconciliationCandidate(event({ eventType: "deposit" }))).not.toBeNull();
    for (const eventType of ["fee", "reserve_hold", "reserve_release", "settlement", "adjustment"] as const) expect(toReconciliationCandidate(event({ eventType }))).toBeNull();
  });

  it("keeps reserve and transit exposure out of provider cost", () => {
    expect(providerCostImpact("12", "EUR", "-8", "EUR")).toBe("20");
    expect(providerCostImpact("12", "USD", "-8", "EUR")).toBe("8");
  });

  it("counts only deposit and withdrawal volume and keeps currency corridors separate", () => {
    const rows = [
      event({ sourceAmount: "1000", sourceAssetCode: "USD", balanceAssetCode: "EUR" }),
      event({ id: 2, providerEventId: "e2", eventType: "withdrawal", sourceAmount: "50", sourceAssetCode: "EUR" }),
      event({ id: 3, providerEventId: "e3", eventType: "fee", sourceAmount: "999", sourceAssetCode: "EUR" }),
      event({ id: 4, providerEventId: "e4", eventType: "reserve_hold", sourceAmount: "999", sourceAssetCode: "EUR" }),
      event({ id: 5, providerEventId: "e5", eventType: "settlement", sourceAmount: "999", sourceAssetCode: "EUR" }),
    ];
    expect(calculateProcessedVolumeCorridors(rows)).toEqual([
      { corridor: "USD → EUR", sourceAssetCode: "USD", balanceAssetCode: "EUR", volume: "1000" },
      { corridor: "EUR", sourceAssetCode: "EUR", balanceAssetCode: "EUR", volume: "50" },
    ]);
  });
});
