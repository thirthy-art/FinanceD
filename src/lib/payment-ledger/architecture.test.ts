import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const paymentService = readFileSync(new URL("./service.ts", import.meta.url), "utf8");
const reconciliationService = readFileSync(new URL("../reconciliation/service.ts", import.meta.url), "utf8");
const paymentImportRoute = readFileSync(new URL("../../../app/api/payment-accounts/import/route.ts", import.meta.url), "utf8");
const legacyImportRoute = readFileSync(new URL("../../../app/api/reconciliation/import/route.ts", import.meta.url), "utf8");

describe("payment-ledger architectural invariants", () => {
  it("persists a PSP upload once as shared provenance plus canonical payment events", () => {
    expect(paymentService).toContain("sourceKind: \"psp_transactions\"");
    expect(paymentService).toContain("tx.insert(paymentEvents)");
    expect(paymentService).not.toContain("insert(reconciliationTransactions)");
    expect(paymentService).toContain("reused: true");
  });

  it("reuses the same canonical import from Client Funds with a legacy fallback", () => {
    expect(reconciliationService).toContain("isCanonicalPaymentImport");
    expect(reconciliationService).toContain("loadCanonicalPaymentEvents");
    expect(reconciliationService).toContain("loadIndexed(db, companyId, \"psp_transactions\", pspImportId)");
    expect(reconciliationService).toContain("reconciliationPaymentMatches");
  });

  it("offers only the canonical PSP upload path for future payment files", () => {
    expect(paymentImportRoute).toContain("createPaymentImport");
    expect(legacyImportRoute).toContain("PSPs & Wallets → Transactions");
    expect(legacyImportRoute).toContain("status: 409");
  });

  it("derives company identity from the active-company boundary on every new mutation route", () => {
    for (const relative of ["../../../app/api/payment-accounts/route.ts", "../../../app/api/payment-accounts/assets/route.ts", "../../../app/api/payment-accounts/import/route.ts", "../../../app/api/payment-accounts/rules/route.ts"]) {
      expect(readFileSync(new URL(relative, import.meta.url), "utf8")).toContain("getActiveCompanyFromRequest");
    }
    expect(paymentService).toContain("requireOwnedAccount");
    expect(paymentService).toContain("eq(paymentEvents.companyId, companyId)");
  });
});
