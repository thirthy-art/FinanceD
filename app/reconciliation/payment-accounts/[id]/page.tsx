import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import CompanySelectionRequired from "@/src/components/CompanySelectionRequired";
import { getMessages, resolveLocale } from "@/src/i18n";
import { LOCALE_COOKIE } from "@/src/i18n/types";
import { getActiveCompanyForPage } from "@/src/lib/active-company-page";
import { getPaymentAccountDeletionImpact, getPaymentAccountDetail } from "@/src/lib/payment-ledger";
import PaymentAccountDetail, { type PaymentAccountDetailView } from "./PaymentAccountDetail";

export const dynamic = "force-dynamic";

export default async function PaymentAccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const paymentAccountId = Number(id);
  if (!Number.isInteger(paymentAccountId) || paymentAccountId <= 0) notFound();
  const cookieStore = await cookies(); const locale = resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value);
  const company = await getActiveCompanyForPage(); if (!company) return <CompanySelectionRequired locale={locale}/>;
  const [result, deletionImpact] = await Promise.all([getPaymentAccountDetail(company.id, paymentAccountId), getPaymentAccountDeletionImpact(company.id, paymentAccountId)]); if (!result || !deletionImpact) notFound();
  const detail: PaymentAccountDetailView = {
    account: result.account,
    openings: result.openings,
    balances: result.balances,
    events: result.events,
    snapshots: result.snapshots.map((snapshot) => ({ ...snapshot, asOf: snapshot.asOf.toISOString() })),
    reserveRules: result.reserveRules,
    reserveLots: result.reserveLots,
  };
  return <PaymentAccountDetail detail={detail} deletionImpact={deletionImpact} messages={getMessages(locale).paymentAccounts}/>;
}
