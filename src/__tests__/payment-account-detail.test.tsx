import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PaymentAccountDetail, { type PaymentAccountDetailView } from "@/app/reconciliation/payment-accounts/[id]/PaymentAccountDetail";
import { getMessages } from "@/src/i18n";

describe("payment account detail", () => {
  it("renders multiple assets, including legacy asset codes, with human-friendly precision", () => {
    const detail: PaymentAccountDetailView = {
      account: { id: 3, name: "Testbank", providerName: "Provider One", accountType: "psp", clientFundsEligible: true },
      openings: [
        { assetCode: "EUR", assetType: "fiat", openingAvailableBalance: "2000.000000000000000000", openingReserveBalance: "1250.500000000000000000", openingBalanceDate: "2026-09-01" },
        { assetCode: "USD", assetType: "fiat", openingAvailableBalance: "9.250000000000000000", openingReserveBalance: "0.000000000000000000", openingBalanceDate: "2026-09-02" },
        { assetCode: "PSP", assetType: "fiat", openingAvailableBalance: "1.000000000000000000", openingReserveBalance: "0.000000000000000000", openingBalanceDate: null },
      ],
      balances: [
        { assetCode: "EUR", available: "2000", reserve: "1250.5", totalOwned: "3250.5", reportedAvailable: "1999", reportedReserve: "1250.5", reportedAsOf: "2026-09-05T00:00:00.000Z" },
        { assetCode: "USD", available: "9.25", reserve: "0", totalOwned: "9.25", reportedAvailable: null, reportedReserve: null, reportedAsOf: null },
        { assetCode: "PSP", available: "1", reserve: "0", totalOwned: "1", reportedAvailable: null, reportedReserve: null, reportedAsOf: null },
      ],
      events: [], snapshots: [], reserveRules: [], reserveLots: [],
    };
    const html = renderToStaticMarkup(<PaymentAccountDetail detail={detail} messages={getMessages("en").paymentAccounts}/>);
    expect(html).toContain("Testbank"); expect(html).toContain(">EUR<"); expect(html).toContain(">USD<"); expect(html).toContain(">PSP<"); expect(html).toContain(">2000<"); expect(html).toContain(">1250.5<"); expect(html).not.toContain("2000.000000000000000000");
  });
});
