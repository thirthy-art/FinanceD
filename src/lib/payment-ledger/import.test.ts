import { describe, expect, it } from "vitest";
import { PaymentImportError, parsePaymentCsv } from "./import";

const header = "transaction_id,event_date,event_type,balance_amount,balance_asset,balance_asset_type,source_amount,source_asset,source_asset_type,actual_fee,fee_asset,expected_fx_rate,status";
describe("single canonical payment import", () => {
  it("normalizes a multi-currency event without using source signs as meaning", () => {
    const parsed = parsePaymentCsv(`${header}\np-1,2026-01-01,deposit,-852,EUR,fiat,1000,USD,fiat,12,EUR,0.860,settled`);
    expect(parsed.events[0]).toMatchObject({ balanceDirection: "credit", balanceAmount: "852", balanceAssetCode: "EUR", sourceAmount: "1000", sourceAssetCode: "USD", expectedFxRate: "0.86" });
    expect(parsed.events[0].providerEventId).toBe("p-1");
    expect(parsed.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each(["payout", "credit", "debit"])("rejects ambiguous provider type %s", (type) => {
    expect(() => parsePaymentCsv(`date,type,amount,currency,asset_type\n2026-01-01,${type},10,EUR,fiat`)).toThrow(/ambiguous/);
  });

  it.each(["deposit", "withdrawal"])("keeps explicit canonical type %s", (type) => {
    expect(parsePaymentCsv(`date,type,amount,currency,asset_type\n2026-01-01,${type},10,EUR,fiat`).events[0].eventType).toBe(type);
  });

  it("preserves provider-level relationships without requiring an internal id", () => {
    const parsed = parsePaymentCsv("provider_event_id,related_provider_event_id,date,type,amount,currency,asset_type\nrelease-1,hold-1,2026-01-02,reserve release,10,EUR,fiat");
    expect(parsed.events[0]).toMatchObject({ providerEventId: "release-1", relatedProviderEventId: "hold-1", relatedEventId: null });
  });

  it.each(["2026-99-99", "2026-02-30"])("rejects impossible event date %s", (date) => {
    expect(() => parsePaymentCsv(`date,type,amount,currency,asset_type\n${date},deposit,10,EUR,fiat`)).toThrow(/real date/);
  });

  it("preserves crypto asset identity", () => {
    const parsed = parsePaymentCsv("date,type,amount,currency,asset_type\n2026-01-01,deposit,10,USDC,crypto");
    expect(parsed.events[0]).toMatchObject({ balanceAssetCode: "USDC", balanceAssetType: "crypto" });
  });

  it("rejects ambiguous event types and incomplete multi-asset facts", () => {
    expect(() => parsePaymentCsv("date,type,amount,currency,asset_type\n2026-01-01,mystery,10,EUR,fiat")).toThrow(PaymentImportError);
    expect(() => parsePaymentCsv("date,type,amount,currency,asset_type,source_amount\n2026-01-01,deposit,10,EUR,fiat,12")).toThrow(/supplied together/);
  });

  it("produces the same duplicate guard for identical canonical content", () => {
    const csv = "date,type,amount,currency,asset_type\n2026-01-01,deposit,10,EUR,fiat";
    expect(parsePaymentCsv(csv).contentHash).toBe(parsePaymentCsv(csv).contentHash);
  });
});
