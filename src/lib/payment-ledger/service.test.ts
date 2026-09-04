import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/src/db";
import * as schema from "@/src/db/schema";
import type { ImportedPaymentEvent } from "./import";
import { createPaymentAccount, createReportedBalanceSnapshot, persistCanonicalPaymentImport } from "./service";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const db = getDb();

const paymentEvent = (overrides: Partial<ImportedPaymentEvent> = {}): ImportedPaymentEvent => ({
  sourceRowNumber: 2, sourceRowId: null, providerEventId: "event-1", relatedProviderEventId: null, relatedPaymentAccountId: null, externalId: "external-1", reference: null,
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
  await db.delete(schema.paymentImportEvents).where(eq(schema.paymentImportEvents.companyId, companyId));
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

  it.skipIf(!HAS_DB)("scopes provider relationships to the explicit source account and keeps resolved links stable", async () => {
    const companyId = await freshCompany();
    try {
      const a = await account(companyId, "PSP A"); const bank = await account(companyId, "Bank A"); const b = await account(companyId, "PSP B");
      await persist(companyId, a.id, "a", [paymentEvent({ providerEventId: "shared", eventType: "settlement", balanceDirection: "debit" })]);
      await persist(companyId, bank.id, "receipt", [paymentEvent({ providerEventId: "receipt", relatedProviderEventId: "shared", relatedPaymentAccountId: a.id })]);
      const [receipt] = await db.select().from(schema.paymentEvents).where(eq(schema.paymentEvents.providerEventId, "receipt"));
      const [source] = await db.select().from(schema.paymentEvents).where(and(eq(schema.paymentEvents.paymentAccountId, a.id), eq(schema.paymentEvents.providerEventId, "shared")));
      expect(receipt.relatedPaymentAccountId).toBe(a.id); expect(receipt.relatedEventId).toBe(source.id);
      await expect(persist(companyId, bank.id, "wrong-account", [paymentEvent({ providerEventId: "bad-direct", relatedEventId: source.id, relatedPaymentAccountId: b.id })])).rejects.toThrow(/does not belong/);
      await persist(companyId, b.id, "b", [paymentEvent({ providerEventId: "shared" })]);
      const [stillResolved] = await db.select().from(schema.paymentEvents).where(eq(schema.paymentEvents.id, receipt.id));
      expect(stillResolved.relatedEventId).toBe(source.id);
    } finally { await cleanup(companyId); }
  });

  it.skipIf(!HAS_DB)("rejects a relationship account owned by another company", async () => {
    const companyId = await freshCompany(); const otherCompanyId = await freshCompany();
    try {
      const local = await account(companyId, "Local PSP"); const foreign = await account(otherCompanyId, "Foreign PSP");
      await expect(persist(companyId, local.id, "cross-company", [paymentEvent({ relatedProviderEventId: "foreign", relatedPaymentAccountId: foreign.id })])).rejects.toThrow(/valid payment account/);
    } finally { await cleanup(companyId); await cleanup(otherCompanyId); }
  });

  it.skipIf(!HAS_DB)("does not guess the source account for a cross-account receipt", async () => {
    const companyId = await freshCompany();
    try {
      const bank = await account(companyId, "Receipt bank");
      await expect(persist(companyId, bank.id, "missing-source", [paymentEvent({ providerEventId: "receipt", relatedProviderEventId: "settlement" })])).rejects.toThrow(/Related payment account is required/);
    } finally { await cleanup(companyId); }
  });

  it.skipIf(!HAS_DB)("retains complete membership across overlapping canonical imports", async () => {
    const companyId = await freshCompany();
    try {
      const a = await account(companyId, "Overlap PSP");
      const rows = (ids: string[]) => ids.map((id, index) => paymentEvent({ sourceRowNumber: index + 2, providerEventId: id, externalId: id }));
      const first = await persist(companyId, a.id, "abc", rows(["A", "B", "C"]));
      const second = await persist(companyId, a.id, "abcde", rows(["A", "B", "C", "D", "E"]));
      const canonical = await db.select().from(schema.paymentEvents).where(eq(schema.paymentEvents.companyId, companyId));
      const firstMembership = await db.select().from(schema.paymentImportEvents).where(eq(schema.paymentImportEvents.importId, first.importId));
      const secondMembership = await db.select().from(schema.paymentImportEvents).where(eq(schema.paymentImportEvents.importId, second.importId));
      expect(first.eventIds).toHaveLength(3); expect(second.eventIds).toHaveLength(2); expect(canonical).toHaveLength(5);
      expect(firstMembership).toHaveLength(3); expect(secondMembership).toHaveLength(5);
      expect(firstMembership.some((row) => secondMembership.some((candidate) => candidate.paymentEventId === row.paymentEventId))).toBe(true);
    } finally { await cleanup(companyId); }
  });

  it.skipIf(!HAS_DB)("stores multi-asset provider snapshots idempotently with manual provenance", async () => {
    const companyId = await freshCompany();
    try {
      const a = await account(companyId, "Snapshot PSP");
      const base = { paymentAccountId: a.id, assetType: "fiat" as const, reportedAvailableBalance: "10", asOf: "2026-01-01", ingestionSource: "manual" as const, providerSnapshotId: "batch-1" };
      expect(await createReportedBalanceSnapshot(companyId, { ...base, assetCode: "EUR" })).not.toBeNull();
      expect(await createReportedBalanceSnapshot(companyId, { ...base, assetCode: "USD" })).not.toBeNull();
      expect(await createReportedBalanceSnapshot(companyId, { ...base, assetCode: "EUR" })).toBeNull();
      const snapshots = await db.select().from(schema.paymentBalanceSnapshots).where(eq(schema.paymentBalanceSnapshots.companyId, companyId));
      expect(snapshots.map((row) => [row.assetCode, row.ingestionSource])).toEqual([["EUR", "manual"], ["USD", "manual"]]);
    } finally { await cleanup(companyId); }
  });
});
