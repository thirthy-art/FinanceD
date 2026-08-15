import { describe, expect, it } from "vitest";
import { calculateVendorInvoiceTotals } from "@/src/lib/vendor-totals";

describe("vendor invoice totals", () => {
  it("includes approved invoices, excludes drafts, and keeps currencies separate", () => {
    const totals = calculateVendorInvoiceTotals([
      { status: "approved", currency: "EUR", grossAmount: "100.10", baseGrossAmount: "100.10" },
      { status: "approved", currency: "USD", grossAmount: "50.25", baseGrossAmount: "46.00" },
      { status: "draft", currency: "EUR", grossAmount: "999.00", baseGrossAmount: "999.00" },
    ]);
    expect(totals.approved).toEqual([
      { currency: "EUR", amount: "100.1" },
      { currency: "USD", amount: "50.25" },
    ]);
    expect(totals.drafts).toEqual([{ currency: "EUR", amount: "999" }]);
    expect(totals.baseApproved).toBe("146.1");
  });
});
