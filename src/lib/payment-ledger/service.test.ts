import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/src/db";
import * as schema from "@/src/db/schema";
import type { ImportedPaymentEvent } from "./import";
import { createPaymentAccount, persistCanonicalPaymentImport } from "./service";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const db = getDb();

const paymentEvent = (overrides: Partial<ImportedPaymentEvent> = {}): ImportedPaymentEvent => ({
  sourceRowNumber: 2, sourceRowId: null, providerEventId: "event-1", relatedProviderEventId: null, externalId: "external-1", reference: null,
  eventDate: "2026-01-01", eventType: "deposit", balanceDirection: "credit", balanceAmount: "100", balanceAssetCode: "EUR", balanceAssetType: "fiat",
  sourceAmount: "100", sourceAssetCode: "EUR", sourceAssetType: "fiat", actualFeeAmount: null, actualFeeAssetCode: null, expectedFxRate: null,
  reportedAvailableBalance: null, reportedReserveBalance: null, expectedReleaseDate: null, destinationAccountId: null, destinationAmount: null,
  destinationAssetCode: null, destinationAssetType: null, expectedDestinationAmount: null, expectedDestinationRate: null, relatedEventId: null, finalReceipt: false,
  status: "settled", statusProvided: true, rawIdentifiers: "{}", ...overrides,
});

async function freshCompany() {
  const [company] = await db.insert(schema.companies).values({ name: `Payment ledger ${Date.now()}-${Math.random()}` }).returning();
  return company.id;
}

async function cleanup(companyId: number) {
  await db.delete(schema.paymentBalanceSnapshots).where(eq(schema.paymentBalanceSnapshots.companyId, companyId));
  await db.delete(schema.paymentEvents).where(eq(schema.paymentEvents.companyId, companyId));
  await db.delete(schema.reconciliationImports).where(eq(schema.reconciliationImports.companyId, companyId));
  await db.delete(schema.paymentAccountAssets).where(eq(schema.paymentAccountAssets.companyId, companyId));
  await db.delete(schema.paymentFeeRules).where(eq(schema.paymentFeeRules.companyId, companyId));
  await db.delete(schema.paymentReserveRules).where(eq(schema.paymentReserveRules.companyId, companyId));
  await db.delete(schema.paymentAccounts).where(eq(schema.paymentAccounts.companyId, companyId));
  await db.delete(schema.companies).where(eq(schema.companies.id, companyId));
}

async function account(companyId: number, name: string) { return createPaymentAccount(companyId, { name, accountType: "psp" }); }
async function persist(companyId: number, accountId: number, hash: string, events: ImportedPaymentEvent[], ingestionSource: "csv" | "xlsx" | "api" = "csv") {
  return persistCanonicalPaymentImport(companyId, accountId, { ingestionSource, sourceIdentity: `${hash}.${ingestionSource}`, contentHash: hash, events });
}

describe("canonical payment persistence (DB)", () => {
  it.skipIf(!HAS_DB)("deduplicates provider events per account while preserving whole-file reuse and provenance", async () => {
    const companyId = await freshCompany();
    try {
      const firstAccount = await account(companyId, "PSP A"); const secondAccount = await account(companyId, "PSP B");
      const first = await persist(companyId, firstAccount.id, "hash-a", [paymentEvent()], "csv");
      const overlap = await persist(companyId, firstAccount.id, "hash-b", [paymentEvent()], "xlsx");
      const otherAccount = await persist(companyId, secondAccount.id, "hash-c", [paymentEvent()], "api");
      const sameFile = await persist(companyId, firstAccount.id, "hash-a", [paymentEvent()], "csv");
      expect(first.eventIds).toHaveLength(1); expect(overlap.eventIds).toHaveLength(0); expect(overlap.skippedProviderDuplicates).toBe(1);
      expect(otherAccount.eventIds).toHaveLength(1); expect(sameFile.reused).toBe(true);
      const imports = await db.select({ source: schema.reconciliationImports.ingestionSource }).from(schema.reconciliationImports).where(eq(schema.reconciliationImports.companyId, companyId));
      expect(new Set(imports.map((row) => row.source))).toEqual(new Set(["csv", "xlsx", "api"]));
    } finally { await cleanup(companyId); }
  });

  it.skipIf(!HAS_DB)("resolves same-import and later-import provider relationships without cross-company leakage", async () => {
    const companyId = await freshCompany(); const otherCompanyId = await freshCompany();
    try {
      const paymentAccount = await account(companyId, "PSP relations"); const otherAccount = await account(otherCompanyId, "Other PSP");
      await persist(companyId, paymentAccount.id, "same", [
        paymentEvent({ providerEventId: "hold-1", eventType: "reserve_hold", balanceDirection: "none" }),
        paymentEvent({ sourceRowNumber: 3, providerEventId: "release-1", relatedProviderEventId: "hold-1", eventType: "reserve_release", balanceDirection: "none" }),
      ]);
      await persist(companyId, paymentAccount.id, "unresolved", [paymentEvent({ providerEventId: "release-2", relatedProviderEventId: "hold-2", eventType: "reserve_release", balanceDirection: "none" })]);
      await persist(otherCompanyId, otherAccount.id, "other", [paymentEvent({ providerEventId: "hold-2", eventType: "reserve_hold", balanceDirection: "none" })]);
      const releaseTwo = (await db.select().from(schema.paymentEvents).where(eq(schema.paymentEvents.providerEventId, "release-2")))[0];
      expect(releaseTwo.relatedEventId).toBeNull();
      await persist(companyId, paymentAccount.id, "later", [paymentEvent({ providerEventId: "hold-2", eventType: "reserve_hold", balanceDirection: "none" })]);
      const rows = await db.select().from(schema.paymentEvents).where(eq(schema.paymentEvents.companyId, companyId));
      const byProvider = new Map(rows.map((row) => [row.providerEventId, row]));
      expect(byProvider.get("release-1")?.relatedEventId).toBe(byProvider.get("hold-1")?.id);
      expect(byProvider.get("release-2")?.relatedEventId).toBe(byProvider.get("hold-2")?.id);
    } finally { await cleanup(companyId); await cleanup(otherCompanyId); }
  });

  it.skipIf(!HAS_DB)("leaves company-wide ambiguous provider relationships unresolved", async () => {
    const companyId = await freshCompany();
    try {
      const a = await account(companyId, "PSP A"); const b = await account(companyId, "PSP B"); const c = await account(companyId, "PSP C");
      await persist(companyId, a.id, "a", [paymentEvent({ providerEventId: "shared" })]);
      await persist(companyId, b.id, "b", [paymentEvent({ providerEventId: "shared" })]);
      await persist(companyId, c.id, "c", [paymentEvent({ providerEventId: "receipt", relatedProviderEventId: "shared" })]);
      const [receipt] = await db.select().from(schema.paymentEvents).where(eq(schema.paymentEvents.providerEventId, "receipt"));
      expect(receipt.relatedEventId).toBeNull();
    } finally { await cleanup(companyId); }
  });
});
