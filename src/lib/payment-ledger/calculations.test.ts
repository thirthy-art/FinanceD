import { describe, expect, it } from "vitest";
import { calculateBalances, calculateFundsInTransit, expectedFee, expectedReserveReleaseDate, feeVariance, fxVariance, groupOwnedFundsByAsset, impliedFx, providerCostImpact, toReconciliationCandidate } from "./calculations";
import type { PaymentEvent } from "./types";

const event = (overrides: Partial<PaymentEvent> = {}): PaymentEvent => ({
  id: 1, companyId: 7, paymentAccountId: 10, importId: 20, sourceRowNumber: 2, sourceRowId: null,
  externalId: "tx-1", reference: "ref-1", eventDate: "2026-01-01", eventType: "deposit",
  balanceDirection: "credit", balanceAmount: "100", balanceAssetCode: "EUR", balanceAssetType: "fiat",
  sourceAmount: "100", sourceAssetCode: "EUR", sourceAssetType: "fiat", actualFeeAmount: null,
  actualFeeAssetCode: null, expectedFxRate: null, reportedAvailableBalance: null, reportedReserveBalance: null,
  expectedReleaseDate: null, destinationAccountId: null, destinationAmount: null, destinationAssetCode: null,
  destinationAssetType: null, expectedDestinationAmount: null, expectedDestinationRate: null, relatedEventId: null,
  status: "settled", statusProvided: true, rawIdentifiers: null, ...overrides,
});
const opening = [{ paymentAccountId: 10, assetCode: "EUR", assetType: "fiat" as const, openingAvailableBalance: "1000", openingReserveBalance: "50" }];

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

  it("derives expected reserve release only from an explicit date or active rule", () => {
    const hold = event({ eventType: "reserve_hold", expectedReleaseDate: null });
    expect(expectedReserveReleaseDate(hold, [])).toBeNull();
    expect(expectedReserveReleaseDate(hold, [{ paymentAccountId: 10, assetCode: "EUR", holdPeriodDays: 30, effectiveFrom: "2025-01-01", effectiveTo: null }])).toBe("2026-01-31");
    expect(expectedReserveReleaseDate({ ...hold, expectedReleaseDate: "2026-03-15" }, [])).toBe("2026-03-15");
  });

  it("creates and clears same-asset funds in transit", () => {
    const sent = event({ id: 5, eventType: "settlement", balanceDirection: "debit", balanceAmount: "80000", destinationAccountId: 11 });
    expect(calculateFundsInTransit([sent])[0].outstandingAmount).toBe("80000");
    const receipt = event({ id: 6, paymentAccountId: 11, eventType: "deposit", balanceAmount: "80000", relatedEventId: 5, destinationAmount: "80000", destinationAssetCode: "EUR", destinationAssetType: "fiat" });
    expect(calculateFundsInTransit([sent, receipt])).toEqual([]);
  });

  it("preserves multi-currency settlement source and destination assets", () => {
    const sent = event({ id: 5, eventType: "settlement", balanceDirection: "debit", balanceAmount: "80000", balanceAssetCode: "USD", destinationAmount: "68200", destinationAssetCode: "EUR", destinationAssetType: "fiat" });
    expect(calculateFundsInTransit([sent])[0]).toMatchObject({ sourceAssetCode: "USD", sourceAmount: "80000" });
    expect(impliedFx(sent.balanceAmount, sent.destinationAmount)).toBe("0.8525");
    const receipt = event({ id: 6, paymentAccountId: 11, balanceAmount: "68200", balanceAssetCode: "EUR", relatedEventId: 5, destinationAmount: "68200", destinationAssetCode: "EUR", destinationAssetType: "fiat" });
    expect(calculateFundsInTransit([sent, receipt])).toEqual([]);
  });

  it("uses target units per one source unit for actual FX", () => expect(impliedFx("1000", "852")).toBe("0.852"));
  it("calculates expected target and FX variance without guessing missing rates", () => {
    expect(fxVariance("1000", "852", "0.860")).toEqual({ expectedTargetAmount: "860", variance: "-8" });
    expect(fxVariance("1000", "852", null)).toBeNull();
  });

  it("calculates dated percentage plus fixed expected fee and actual-minus-expected variance", () => {
    const payment = event({ sourceAmount: "1000", actualFeeAmount: "27", actualFeeAssetCode: "EUR" });
    const rules = [{ paymentAccountId: 10, eventType: "deposit" as const, assetCode: "EUR", percentageRate: "2.5", fixedAmount: "1", fixedAssetCode: "EUR", effectiveFrom: "2025-01-01", effectiveTo: null }];
    expect(expectedFee(payment, rules)).toBe("26"); expect(feeVariance(payment, rules)).toBe("1");
  });

  it("returns unavailable when no fee rule exists or fee assets differ", () => {
    expect(expectedFee(event(), [])).toBeNull();
    const rules = [{ paymentAccountId: 10, eventType: "deposit" as const, assetCode: "EUR", percentageRate: "1", fixedAmount: "0", fixedAssetCode: "EUR", effectiveFrom: "2025-01-01", effectiveTo: null }];
    expect(feeVariance(event({ actualFeeAmount: "1", actualFeeAssetCode: "USD" }), rules)).toBeNull();
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
});
