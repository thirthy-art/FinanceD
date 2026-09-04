import { and, eq, isNotNull } from "drizzle-orm";
import { getDb, type Db } from "@/src/db";
import { paymentAccountAssets, paymentAccounts, paymentBalanceSnapshots, paymentEvents, paymentFeeRules, paymentImportEvents, paymentReserveRules, reconciliationImports } from "@/src/db/schema";
import type { AssetType, FeeBasis, PaymentAccountType, PaymentEventType, PaymentIngestionSource } from "./types";
import { Decimal } from "@/src/lib/decimal";
import type { ImportedPaymentEvent } from "./import";
import { isValidDateOnly, requireDateOnly, validateDateRange } from "./validation";

export function normalizeAssetCode(value: string): string {
  const code = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]{0,19}$/.test(code)) throw new Error("Asset code must be 1-20 letters, numbers, dots, underscores, or hyphens.");
  return code;
}

function validDecimal(value: string, label: string): void {
  try { if (!new Decimal(value).isFinite()) throw new Error(); }
  catch { throw new Error(`${label} must be a valid Decimal value.`); }
}

export async function createPaymentAccount(companyId: number, input: { name: string; providerName?: string | null; accountType: PaymentAccountType; clientFundsEligible?: boolean }) {
  const name = input.name.trim();
  if (!name || name.length > 255) throw new Error("Payment account name is required.");
  const [created] = await getDb().insert(paymentAccounts).values({ companyId, name, providerName: input.providerName?.trim() || null, accountType: input.accountType, clientFundsEligible: input.clientFundsEligible ?? input.accountType === "psp" }).returning();
  return created;
}

export async function setClientFundsEligibility(companyId: number, paymentAccountId: number, clientFundsEligible: boolean) {
  const db = getDb(); await requireOwnedAccount(db, companyId, paymentAccountId);
  const [updated] = await db.update(paymentAccounts).set({ clientFundsEligible, updatedAt: new Date() }).where(and(eq(paymentAccounts.id, paymentAccountId), eq(paymentAccounts.companyId, companyId))).returning();
  return updated;
}

export async function upsertAccountAsset(companyId: number, input: { paymentAccountId: number; assetCode: string; assetType: AssetType; openingAvailableBalance: string; openingReserveBalance: string; openingBalanceDate?: string | null }) {
  const db = getDb(); await requireOwnedAccount(db, companyId, input.paymentAccountId);
  validDecimal(input.openingAvailableBalance, "Opening available balance"); validDecimal(input.openingReserveBalance, "Opening reserve balance");
  const openingBalanceDate = input.openingBalanceDate || null;
  if (openingBalanceDate !== null) requireDateOnly(openingBalanceDate, "Opening balance date");
  const assetCode = normalizeAssetCode(input.assetCode);
  const [row] = await db.insert(paymentAccountAssets).values({ ...input, companyId, assetCode, openingBalanceDate }).onConflictDoUpdate({
    target: [paymentAccountAssets.paymentAccountId, paymentAccountAssets.assetCode],
    set: { assetType: input.assetType, openingAvailableBalance: input.openingAvailableBalance, openingReserveBalance: input.openingReserveBalance, openingBalanceDate, updatedAt: new Date() },
  }).returning();
  return row;
}

export interface CanonicalPaymentImportInput { ingestionSource: PaymentIngestionSource; sourceIdentity: string; contentHash: string; events: ImportedPaymentEvent[]; }

/** Shared persistence boundary for CSV, XLSX, and future API adapters. */
export async function persistCanonicalPaymentImport(companyId: number, paymentAccountId: number, input: CanonicalPaymentImportInput) {
  const db = getDb(); await requireOwnedAccount(db, companyId, paymentAccountId);
  const overlapWarning = input.events.some((event) => !event.providerEventId);
  for (const event of input.events) {
    if (event.destinationAccountId !== null) await requireOwnedAccount(db, companyId, event.destinationAccountId);
    if (event.relatedPaymentAccountId !== null) await requireOwnedAccount(db, companyId, event.relatedPaymentAccountId);
    if (event.relatedProviderEventId?.trim() && event.relatedPaymentAccountId === null && event.eventType !== "reserve_release") throw new Error("Related payment account is required for this provider relationship.");
    if (event.relatedEventId !== null) {
      const relationshipAccountId = event.relatedPaymentAccountId ?? paymentAccountId;
      const [related] = await db.select({ id: paymentEvents.id }).from(paymentEvents).where(and(eq(paymentEvents.id, event.relatedEventId), eq(paymentEvents.companyId, companyId), eq(paymentEvents.paymentAccountId, relationshipAccountId))).limit(1);
      if (!related) throw new Error("A related payment event does not belong to the active company.");
    }
  }
  const [existing] = await db.select({ id: reconciliationImports.id }).from(reconciliationImports).where(and(eq(reconciliationImports.companyId, companyId), eq(reconciliationImports.sourceKind, "psp_transactions"), eq(reconciliationImports.paymentAccountId, paymentAccountId), eq(reconciliationImports.contentHash, input.contentHash))).limit(1);
  if (existing) return { importId: existing.id, eventIds: [] as number[], reused: true, skippedProviderDuplicates: 0, overlapWarning };

  const result = await db.transaction(async (tx) => {
    const [importRow] = await tx.insert(reconciliationImports).values({ companyId, sourceKind: "psp_transactions", paymentAccountId, ingestionSource: input.ingestionSource, originalFilename: input.sourceIdentity, contentHash: input.contentHash, rowCount: input.events.length }).returning({ id: reconciliationImports.id });
    const seen = new Set<string>(); const eventIds: number[] = []; let skippedProviderDuplicates = 0;
    for (const event of input.events) {
      const providerEventId = event.providerEventId?.trim() || null;
      if (providerEventId !== null && seen.has(providerEventId)) { skippedProviderDuplicates++; continue; }
      if (providerEventId !== null) seen.add(providerEventId);
      const relatedProviderEventId = event.relatedProviderEventId?.trim() || null;
      const relatedPaymentAccountId = relatedProviderEventId !== null && event.eventType === "reserve_release"
        ? (event.relatedPaymentAccountId ?? paymentAccountId)
        : event.relatedPaymentAccountId;
      const [inserted] = await tx.insert(paymentEvents).values({ ...event, providerEventId, relatedProviderEventId, relatedPaymentAccountId, companyId, paymentAccountId, importId: importRow.id }).onConflictDoNothing().returning({ id: paymentEvents.id });
      let paymentEventId = inserted?.id;
      if (inserted) eventIds.push(inserted.id);
      else if (providerEventId !== null) {
        skippedProviderDuplicates++;
        const [canonical] = await tx.select({ id: paymentEvents.id }).from(paymentEvents).where(and(eq(paymentEvents.companyId, companyId), eq(paymentEvents.paymentAccountId, paymentAccountId), eq(paymentEvents.providerEventId, providerEventId))).limit(1);
        paymentEventId = canonical?.id;
      }
      if (paymentEventId !== undefined) await tx.insert(paymentImportEvents).values({ companyId, importId: importRow.id, paymentEventId, sourceRowNumber: event.sourceRowNumber }).onConflictDoNothing();
    }
    await resolveProviderRelationships(tx as unknown as Db, companyId);
    return { importId: importRow.id, eventIds, skippedProviderDuplicates };
  });
  return { ...result, reused: false, overlapWarning };
}

/** Compatibility wrapper retained for file-route callers. */
export async function createPaymentImport(companyId: number, paymentAccountId: number, originalFilename: string, events: ImportedPaymentEvent[], contentHash: string, ingestionSource: "csv" | "xlsx" = "csv") {
  return persistCanonicalPaymentImport(companyId, paymentAccountId, { ingestionSource, sourceIdentity: originalFilename, events, contentHash });
}

async function resolveProviderRelationships(db: Db, companyId: number): Promise<void> {
  const [unresolved, targets] = await Promise.all([
    db.select({ id: paymentEvents.id, relatedPaymentAccountId: paymentEvents.relatedPaymentAccountId, relatedProviderEventId: paymentEvents.relatedProviderEventId, relatedEventId: paymentEvents.relatedEventId }).from(paymentEvents).where(and(eq(paymentEvents.companyId, companyId), isNotNull(paymentEvents.relatedProviderEventId))),
    db.select({ id: paymentEvents.id, paymentAccountId: paymentEvents.paymentAccountId, providerEventId: paymentEvents.providerEventId }).from(paymentEvents).where(and(eq(paymentEvents.companyId, companyId), isNotNull(paymentEvents.providerEventId))),
  ]);
  const byProvider = new Map<string, number>();
  for (const target of targets) if (target.providerEventId !== null) byProvider.set(`${target.paymentAccountId}:${target.providerEventId}`, target.id);
  for (const row of unresolved) {
    if (row.relatedProviderEventId === null || row.relatedPaymentAccountId === null) continue;
    const targetId = byProvider.get(`${row.relatedPaymentAccountId}:${row.relatedProviderEventId}`) ?? null;
    if (targetId !== null && row.relatedEventId !== targetId) await db.update(paymentEvents).set({ relatedEventId: targetId }).where(and(eq(paymentEvents.id, row.id), eq(paymentEvents.companyId, companyId)));
  }
}

export async function createReportedBalanceSnapshot(companyId: number, input: { paymentAccountId: number; assetCode: string; assetType: AssetType; reportedAvailableBalance: string; reportedReserveBalance?: string | null; asOf: string | Date; ingestionSource: PaymentIngestionSource; providerSnapshotId?: string | null }) {
  const db = getDb(); await requireOwnedAccount(db, companyId, input.paymentAccountId);
  validDecimal(input.reportedAvailableBalance, "Reported available balance"); if (input.reportedReserveBalance != null) validDecimal(input.reportedReserveBalance, "Reported reserve balance");
  if (typeof input.asOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.asOf) && !isValidDateOnly(input.asOf)) throw new Error("Snapshot as-of must be a real timestamp or date.");
  const asOf = input.asOf instanceof Date ? input.asOf : new Date(input.asOf);
  if (Number.isNaN(asOf.getTime())) throw new Error("Snapshot as-of must be a real timestamp or date.");
  const assetCode = normalizeAssetCode(input.assetCode);
  const [knownAsset] = await db.select({ assetType: paymentAccountAssets.assetType }).from(paymentAccountAssets).where(and(eq(paymentAccountAssets.companyId, companyId), eq(paymentAccountAssets.paymentAccountId, input.paymentAccountId), eq(paymentAccountAssets.assetCode, assetCode))).limit(1);
  const [knownSnapshot] = await db.select({ assetType: paymentBalanceSnapshots.assetType }).from(paymentBalanceSnapshots).where(and(eq(paymentBalanceSnapshots.companyId, companyId), eq(paymentBalanceSnapshots.paymentAccountId, input.paymentAccountId), eq(paymentBalanceSnapshots.assetCode, assetCode))).limit(1);
  if ((knownAsset && knownAsset.assetType !== input.assetType) || (knownSnapshot && knownSnapshot.assetType !== input.assetType)) throw new Error("Snapshot asset type conflicts with the existing account asset.");
  const [row] = await db.insert(paymentBalanceSnapshots).values({ companyId, paymentAccountId: input.paymentAccountId, assetCode, assetType: input.assetType, reportedAvailableBalance: input.reportedAvailableBalance, reportedReserveBalance: input.reportedReserveBalance ?? null, asOf, ingestionSource: input.ingestionSource, providerSnapshotId: input.providerSnapshotId?.trim() || null }).onConflictDoNothing().returning();
  return row ?? null;
}

export async function createFeeRule(companyId: number, input: { paymentAccountId: number; eventType: PaymentEventType; feeBasis: FeeBasis; assetCode?: string | null; feeAssetCode: string; percentageRate: string; fixedAmount: string; effectiveFrom: string; effectiveTo?: string | null }) {
  const db = getDb(); await requireOwnedAccount(db, companyId, input.paymentAccountId);
  validDecimal(input.percentageRate, "Fee percentage"); validDecimal(input.fixedAmount, "Fixed fee");
  if (new Decimal(input.percentageRate).isNegative() || new Decimal(input.fixedAmount).isNegative()) throw new Error("Fee values cannot be negative.");
  validateDateRange(input.effectiveFrom, input.effectiveTo);
  const assetCode = input.assetCode ? normalizeAssetCode(input.assetCode) : null; const feeAssetCode = normalizeAssetCode(input.feeAssetCode); const effectiveTo = input.effectiveTo || null;
  const existing = await db.select().from(paymentFeeRules).where(and(eq(paymentFeeRules.companyId, companyId), eq(paymentFeeRules.paymentAccountId, input.paymentAccountId), eq(paymentFeeRules.eventType, input.eventType)));
  if (existing.some((rule) => rule.feeBasis === input.feeBasis && (rule.assetCode ?? null) === assetCode && (rule.feeAssetCode ?? rule.fixedAssetCode ?? null) === feeAssetCode && input.effectiveFrom <= (rule.effectiveTo ?? "9999-12-31") && rule.effectiveFrom <= (effectiveTo ?? "9999-12-31"))) throw new Error("An equivalent fee rule already overlaps this effective date range.");
  const [row] = await db.insert(paymentFeeRules).values({ ...input, companyId, assetCode, feeAssetCode, fixedAssetCode: feeAssetCode, effectiveTo }).returning(); return row;
}

export async function createReserveRule(companyId: number, input: { paymentAccountId: number; assetCode?: string | null; reservePercentage?: string | null; holdPeriodDays?: number | null; effectiveFrom: string; effectiveTo?: string | null }) {
  const db = getDb(); await requireOwnedAccount(db, companyId, input.paymentAccountId);
  if (input.reservePercentage != null) { validDecimal(input.reservePercentage, "Reserve percentage"); if (new Decimal(input.reservePercentage).isNegative()) throw new Error("Reserve percentage cannot be negative."); }
  if (input.holdPeriodDays != null && (!Number.isInteger(input.holdPeriodDays) || input.holdPeriodDays < 0)) throw new Error("Hold period must be a non-negative whole number.");
  validateDateRange(input.effectiveFrom, input.effectiveTo);
  const [row] = await db.insert(paymentReserveRules).values({ ...input, companyId, assetCode: input.assetCode ? normalizeAssetCode(input.assetCode) : null, reservePercentage: input.reservePercentage ?? null, holdPeriodDays: input.holdPeriodDays ?? null, effectiveTo: input.effectiveTo || null }).returning(); return row;
}

async function requireOwnedAccount(db: Db, companyId: number, accountId: number) {
  const [account] = await db.select({ id: paymentAccounts.id }).from(paymentAccounts).where(and(eq(paymentAccounts.id, accountId), eq(paymentAccounts.companyId, companyId))).limit(1);
  if (!account) throw new Error("No valid payment account is available for this company.");
}
