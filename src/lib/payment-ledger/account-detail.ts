import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/src/db";
import { paymentAccountAssets, paymentAccounts, paymentBalanceSnapshots, paymentEvents, paymentReserveRules } from "@/src/db/schema";
import { calculateBalances, calculateReserveLots } from "./calculations";
import type { AccountAssetOpening, PaymentEvent, ReportedBalanceSnapshot, ReserveRule } from "./types";

const decimal = (value: unknown) => String(value);

export async function getPaymentAccountDetail(companyId: number, paymentAccountId: number) {
  const db = getDb();
  const [account] = await db.select().from(paymentAccounts).where(and(eq(paymentAccounts.id, paymentAccountId), eq(paymentAccounts.companyId, companyId))).limit(1);
  if (!account) return null;
  const [assetRows, eventRows, snapshotRows, reserveRuleRows] = await Promise.all([
    db.select().from(paymentAccountAssets).where(and(eq(paymentAccountAssets.companyId, companyId), eq(paymentAccountAssets.paymentAccountId, paymentAccountId))).orderBy(asc(paymentAccountAssets.assetCode)),
    db.select().from(paymentEvents).where(and(eq(paymentEvents.companyId, companyId), eq(paymentEvents.paymentAccountId, paymentAccountId))).orderBy(desc(paymentEvents.eventDate), desc(paymentEvents.id)),
    db.select().from(paymentBalanceSnapshots).where(and(eq(paymentBalanceSnapshots.companyId, companyId), eq(paymentBalanceSnapshots.paymentAccountId, paymentAccountId))).orderBy(desc(paymentBalanceSnapshots.asOf), desc(paymentBalanceSnapshots.id)),
    db.select().from(paymentReserveRules).where(and(eq(paymentReserveRules.companyId, companyId), eq(paymentReserveRules.paymentAccountId, paymentAccountId))).orderBy(desc(paymentReserveRules.effectiveFrom), desc(paymentReserveRules.id)),
  ]);
  const openings = assetRows.map((row): AccountAssetOpening => ({ paymentAccountId: row.paymentAccountId, assetCode: row.assetCode, assetType: row.assetType, openingAvailableBalance: decimal(row.openingAvailableBalance), openingReserveBalance: decimal(row.openingReserveBalance), openingBalanceDate: row.openingBalanceDate }));
  const events = eventRows.map((row): PaymentEvent => ({ ...row, balanceAmount: decimal(row.balanceAmount), sourceAmount: row.sourceAmount === null ? null : decimal(row.sourceAmount), actualFeeAmount: row.actualFeeAmount === null ? null : decimal(row.actualFeeAmount), expectedFxRate: row.expectedFxRate === null ? null : decimal(row.expectedFxRate), reportedAvailableBalance: row.reportedAvailableBalance === null ? null : decimal(row.reportedAvailableBalance), reportedReserveBalance: row.reportedReserveBalance === null ? null : decimal(row.reportedReserveBalance), destinationAmount: row.destinationAmount === null ? null : decimal(row.destinationAmount), expectedDestinationAmount: row.expectedDestinationAmount === null ? null : decimal(row.expectedDestinationAmount), expectedDestinationRate: row.expectedDestinationRate === null ? null : decimal(row.expectedDestinationRate) }));
  const snapshots = snapshotRows.map((row): ReportedBalanceSnapshot => ({ paymentAccountId: row.paymentAccountId, assetCode: row.assetCode, assetType: row.assetType, reportedAvailableBalance: decimal(row.reportedAvailableBalance), reportedReserveBalance: row.reportedReserveBalance === null ? null : decimal(row.reportedReserveBalance), asOf: row.asOf }));
  const reserveRules = reserveRuleRows.map((row) => ({ ...row, reservePercentage: row.reservePercentage === null ? null : decimal(row.reservePercentage) }));
  const calculationRules: ReserveRule[] = reserveRules.map((row) => ({ paymentAccountId: row.paymentAccountId, assetCode: row.assetCode, holdPeriodDays: row.holdPeriodDays, effectiveFrom: row.effectiveFrom, effectiveTo: row.effectiveTo }));
  return { account, openings, events, snapshots, reserveRules, balances: calculateBalances(openings, events, snapshots), reserveLots: calculateReserveLots(events, calculationRules) };
}
