import { and, eq } from "drizzle-orm";
import { getDb, type Db } from "@/src/db";
import { paymentAccountAssets, paymentAccounts, paymentEvents, paymentFeeRules, paymentReserveRules, reconciliationImports } from "@/src/db/schema";
import type { AssetType, PaymentAccountType, PaymentEventType } from "./types";
import { Decimal } from "@/src/lib/decimal";
import type { ImportedPaymentEvent } from "./import";

export function normalizeAssetCode(value: string): string {
  const code = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]{0,19}$/.test(code)) throw new Error("Asset code must be 1-20 letters, numbers, dots, underscores, or hyphens.");
  return code;
}

export async function createPaymentAccount(companyId: number, input: { name: string; providerName?: string | null; accountType: PaymentAccountType }) {
  const name = input.name.trim();
  if (!name || name.length > 255) throw new Error("Payment account name is required.");
  const [created] = await getDb().insert(paymentAccounts).values({ companyId, name, providerName: input.providerName?.trim() || null, accountType: input.accountType }).returning();
  return created;
}

export async function upsertAccountAsset(companyId: number, input: { paymentAccountId: number; assetCode: string; assetType: AssetType; openingAvailableBalance: string; openingReserveBalance: string; openingBalanceDate?: string | null }) {
  const db = getDb();
  await requireOwnedAccount(db, companyId, input.paymentAccountId);
  for (const value of [input.openingAvailableBalance, input.openingReserveBalance]) { if (!new Decimal(value).isFinite()) throw new Error("Opening balances must be valid Decimal values."); }
  const assetCode = normalizeAssetCode(input.assetCode);
  const [row] = await db.insert(paymentAccountAssets).values({ ...input, companyId, assetCode, openingBalanceDate: input.openingBalanceDate ?? null }).onConflictDoUpdate({
    target: [paymentAccountAssets.paymentAccountId, paymentAccountAssets.assetCode],
    set: { assetType: input.assetType, openingAvailableBalance: input.openingAvailableBalance, openingReserveBalance: input.openingReserveBalance, openingBalanceDate: input.openingBalanceDate ?? null, updatedAt: new Date() },
  }).returning();
  return row;
}

export async function createPaymentImport(companyId: number, paymentAccountId: number, originalFilename: string, events: ImportedPaymentEvent[], contentHash: string) {
  const db = getDb();
  await requireOwnedAccount(db, companyId, paymentAccountId);
  for (const event of events) {
    if (event.destinationAccountId !== null) await requireOwnedAccount(db, companyId, event.destinationAccountId);
    if (event.relatedEventId !== null) {
      const [related] = await db.select({ id: paymentEvents.id }).from(paymentEvents).where(and(eq(paymentEvents.id, event.relatedEventId), eq(paymentEvents.companyId, companyId))).limit(1);
      if (!related) throw new Error("A related payment event does not belong to the active company.");
    }
  }
  const [existing] = await db.select({ id: reconciliationImports.id }).from(reconciliationImports).where(and(
    eq(reconciliationImports.companyId, companyId), eq(reconciliationImports.sourceKind, "psp_transactions"), eq(reconciliationImports.contentHash, contentHash)
  )).limit(1);
  if (existing) return { importId: existing.id, eventIds: [] as number[], reused: true };
  return db.transaction(async (tx) => {
    const [importRow] = await tx.insert(reconciliationImports).values({ companyId, sourceKind: "psp_transactions", paymentAccountId, originalFilename, contentHash, rowCount: events.length }).returning({ id: reconciliationImports.id });
    const inserted = events.length ? await tx.insert(paymentEvents).values(events.map((event) => ({ ...event, companyId, paymentAccountId, importId: importRow.id }))).returning({ id: paymentEvents.id }) : [];
    return { importId: importRow.id, eventIds: inserted.map((row) => row.id), reused: false };
  });
}

export async function createFeeRule(companyId: number, input: { paymentAccountId: number; eventType: PaymentEventType; assetCode?: string | null; percentageRate: string; fixedAmount: string; fixedAssetCode?: string | null; effectiveFrom: string; effectiveTo?: string | null }) {
  const db = getDb(); await requireOwnedAccount(db, companyId, input.paymentAccountId);
  if (new Decimal(input.percentageRate).isNegative() || new Decimal(input.fixedAmount).isNegative()) throw new Error("Fee values cannot be negative.");
  const [row] = await db.insert(paymentFeeRules).values({ ...input, companyId, assetCode: input.assetCode ? normalizeAssetCode(input.assetCode) : null, fixedAssetCode: input.fixedAssetCode ? normalizeAssetCode(input.fixedAssetCode) : null, effectiveTo: input.effectiveTo ?? null }).returning();
  return row;
}

export async function createReserveRule(companyId: number, input: { paymentAccountId: number; assetCode?: string | null; reservePercentage?: string | null; holdPeriodDays?: number | null; effectiveFrom: string; effectiveTo?: string | null }) {
  const db = getDb(); await requireOwnedAccount(db, companyId, input.paymentAccountId);
  if (input.reservePercentage != null && new Decimal(input.reservePercentage).isNegative()) throw new Error("Reserve percentage cannot be negative.");
  if (input.holdPeriodDays != null && (!Number.isInteger(input.holdPeriodDays) || input.holdPeriodDays < 0)) throw new Error("Hold period must be a non-negative whole number.");
  const [row] = await db.insert(paymentReserveRules).values({ ...input, companyId, assetCode: input.assetCode ? normalizeAssetCode(input.assetCode) : null, reservePercentage: input.reservePercentage ?? null, holdPeriodDays: input.holdPeriodDays ?? null, effectiveTo: input.effectiveTo ?? null }).returning();
  return row;
}

async function requireOwnedAccount(db: Db, companyId: number, accountId: number) {
  const [account] = await db.select({ id: paymentAccounts.id }).from(paymentAccounts).where(and(eq(paymentAccounts.id, accountId), eq(paymentAccounts.companyId, companyId))).limit(1);
  if (!account) throw new Error("No valid payment account is available for this company.");
}
