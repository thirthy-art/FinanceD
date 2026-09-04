import { cookies } from "next/headers";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/src/db";
import { paymentAccountAssets, paymentAccounts, paymentEvents, paymentFeeRules, paymentReserveRules } from "@/src/db/schema";
import { getActiveCompanyForPage } from "@/src/lib/active-company-page";
import CompanySelectionRequired from "@/src/components/CompanySelectionRequired";
import { resolveLocale } from "@/src/i18n";
import { LOCALE_COOKIE } from "@/src/i18n/types";
import { calculateBalances, calculateFundsInTransit, expectedFee, expectedReserveReleaseDate, feeVariance, fxVariance, groupOwnedFundsByAsset, impliedFx, type PaymentEvent } from "@/src/lib/payment-ledger";
import PaymentAccountsClient from "./PaymentAccountsClient";
import { Decimal } from "@/src/lib/decimal";

export const dynamic = "force-dynamic";

export default async function PaymentAccountsPage() {
  const cookieStore = await cookies(); const locale = resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value);
  const company = await getActiveCompanyForPage(); if (!company) return <CompanySelectionRequired locale={locale} />;
  const db = getDb();
  const [accounts, openings, eventRows, feeRules, reserveRules] = await Promise.all([
    db.select().from(paymentAccounts).where(eq(paymentAccounts.companyId, company.id)).orderBy(asc(paymentAccounts.name)),
    db.select().from(paymentAccountAssets).where(eq(paymentAccountAssets.companyId, company.id)),
    db.select().from(paymentEvents).where(eq(paymentEvents.companyId, company.id)).orderBy(asc(paymentEvents.eventDate), asc(paymentEvents.id)),
    db.select().from(paymentFeeRules).where(eq(paymentFeeRules.companyId, company.id)),
    db.select().from(paymentReserveRules).where(eq(paymentReserveRules.companyId, company.id)),
  ]);
  const events = eventRows.map((event) => ({ ...event, balanceAmount: String(event.balanceAmount), sourceAmount: event.sourceAmount === null ? null : String(event.sourceAmount), actualFeeAmount: event.actualFeeAmount === null ? null : String(event.actualFeeAmount), expectedFxRate: event.expectedFxRate === null ? null : String(event.expectedFxRate), reportedAvailableBalance: event.reportedAvailableBalance === null ? null : String(event.reportedAvailableBalance), reportedReserveBalance: event.reportedReserveBalance === null ? null : String(event.reportedReserveBalance), destinationAmount: event.destinationAmount === null ? null : String(event.destinationAmount), expectedDestinationAmount: event.expectedDestinationAmount === null ? null : String(event.expectedDestinationAmount), expectedDestinationRate: event.expectedDestinationRate === null ? null : String(event.expectedDestinationRate) })) as PaymentEvent[];
  const normalizedOpenings = openings.map((row) => ({ paymentAccountId: row.paymentAccountId, assetCode: row.assetCode, assetType: row.assetType, openingAvailableBalance: String(row.openingAvailableBalance), openingReserveBalance: String(row.openingReserveBalance) }));
  const normalizedFeeRules = feeRules.map((row) => ({ ...row, percentageRate: String(row.percentageRate), fixedAmount: String(row.fixedAmount) }));
  const normalizedReserveRules = reserveRules.map((row) => ({ ...row, reservePercentage: row.reservePercentage === null ? null : String(row.reservePercentage) }));
  const balances = calculateBalances(normalizedOpenings, events); const transit = calculateFundsInTransit(events); const totals = groupOwnedFundsByAsset(balances, transit);
  const eventView = events.map((event) => {
    const settlementConversion = event.destinationAmount !== null && event.destinationAssetCode !== null;
    const fxSource = settlementConversion ? event.balanceAmount : event.sourceAmount;
    const fxTarget = settlementConversion ? event.destinationAmount : event.balanceAmount;
    const fxExpected = settlementConversion ? event.expectedDestinationRate : event.expectedFxRate;
    return { ...event, impliedFx: impliedFx(fxSource, fxTarget), fx: fxVariance(fxSource, fxTarget, fxExpected), expectedFee: expectedFee(event, normalizedFeeRules), feeVariance: feeVariance(event, normalizedFeeRules) };
  });
  const reserveLots = events.filter((event) => event.eventType === "reserve_hold").map((hold) => {
    const releases = events.filter((event) => event.eventType === "reserve_release" && event.relatedEventId === hold.id);
    const released = releases.reduce((sum, event) => sum.plus(event.balanceAmount), new Decimal(0));
    return { id: hold.id, paymentAccountId: hold.paymentAccountId, assetCode: hold.balanceAssetCode, holdDate: hold.eventDate, amount: hold.balanceAmount, expectedReleaseDate: expectedReserveReleaseDate(hold, normalizedReserveRules), released: released.toFixed(), actualReleaseDate: releases.at(-1)?.eventDate ?? null, outstanding: new Decimal(hold.balanceAmount).minus(released).toFixed() };
  });
  return <PaymentAccountsClient accounts={accounts.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }))} events={eventView} balances={balances} totals={totals} transit={transit} reserveLots={reserveLots} />;
}
