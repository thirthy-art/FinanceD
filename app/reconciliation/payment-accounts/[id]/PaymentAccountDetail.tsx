import Link from "next/link";
import type { ReactNode } from "react";
import type { Messages } from "@/src/i18n";
import { Decimal } from "@/src/lib/decimal";
import type { AssetType, BalanceDirection, PaymentAccountType, PaymentEventType } from "@/src/lib/payment-ledger";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { EmptyState } from "@/src/components/ui/feedback";
import { PageDescription, PageHeader, PageHeading, PageTitle } from "@/src/components/ui/page";
import { AccountDeleteAction, TransactionActions } from "./PaymentAccountMutationControls";

export type PaymentAccountDetailView = {
  account: { id: number; name: string; providerName: string | null; accountType: PaymentAccountType; clientFundsEligible: boolean };
  openings: Array<{ assetCode: string; assetType: AssetType; openingAvailableBalance: string; openingReserveBalance: string; openingBalanceDate: string | null }>;
  balances: Array<{ assetCode: string; available: string; reserve: string; totalOwned: string; reportedAvailable: string | null; reportedReserve: string | null; reportedAsOf: string | null }>;
  events: Array<{ id: number; eventDate: string; eventType: PaymentEventType; balanceDirection: BalanceDirection; balanceAmount: string; balanceAssetCode: string; balanceAssetType: AssetType; providerEventId: string | null; reference: string | null }>;
  snapshots: Array<{ assetCode: string; reportedAvailableBalance: string; reportedReserveBalance: string | null; asOf: string }>;
  reserveRules: Array<{ id: number; assetCode: string | null; reservePercentage: string | null; holdPeriodDays: number | null; effectiveFrom: string; effectiveTo: string | null }>;
  reserveLots: Array<{ id: number; assetCode: string; holdDate: string; amount: string; expectedReleaseDate: string | null; released: string; actualReleaseDate: string | null; outstanding: string }>;
};

export default function PaymentAccountDetail({ detail, messages }: { detail: PaymentAccountDetailView; messages: Messages["paymentAccounts"] }) {
  const openingByAsset = new Map(detail.openings.map((row) => [row.assetCode, row]));
  return <div className="payment-account-detail-page">
    <PageHeader><PageHeading><Link href="/reconciliation/payment-accounts" className="ui-back-link">← {messages.backToAccounts}</Link><PageTitle>{detail.account.name}</PageTitle><PageDescription>{messages.accountDetails}</PageDescription></PageHeading></PageHeader>
    <Card className="mb-5"><CardContent className="pt-5"><dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Info label={messages.accountName} value={detail.account.name}/><Info label={messages.providerName} value={detail.account.providerName ?? "—"}/><Info label={messages.accountType} value={messages.accountTypeLabels[detail.account.accountType]}/><Info label={messages.clientFundsEligible} value={detail.account.clientFundsEligible ? messages.eligible : messages.notEligible}/>
    </dl></CardContent></Card>
    <Card className="mb-5"><CardHeader><CardTitle>{messages.balances}</CardTitle></CardHeader><CardContent><Table headers={[messages.asset, messages.assetType, messages.openingAvailable, messages.openingReserve, messages.openingBalanceDate, messages.currentCalculatedAvailable, messages.calculatedReserve, messages.totalFunds, messages.reportedBalance, messages.reportedReserve, messages.reportedAsOf]} rows={detail.balances.map((balance) => { const opening = openingByAsset.get(balance.assetCode); return [balance.assetCode, opening ? messages[opening.assetType] : "—", amount(opening?.openingAvailableBalance), amount(opening?.openingReserveBalance), opening?.openingBalanceDate ?? "—", amount(balance.available), amount(balance.reserve), amount(balance.totalOwned), amount(balance.reportedAvailable), amount(balance.reportedReserve), balance.reportedAsOf?.slice(0, 10) ?? "—"]; })}/></CardContent></Card>
    <Card className="mb-5"><CardHeader><CardTitle>{messages.transactions}</CardTitle></CardHeader><CardContent>{detail.events.length === 0 ? <EmptyState>{messages.noTransactions}</EmptyState> : <TransactionActions events={detail.events.map((event) => ({ ...event, balanceAmount: amount(event.balanceAmount) }))} messages={messages}/>}</CardContent></Card>
    <Card className="mb-5"><CardHeader><CardTitle>{messages.reportedSnapshots}</CardTitle></CardHeader><CardContent>{detail.snapshots.length === 0 ? <EmptyState>{messages.noSnapshots}</EmptyState> : <Table headers={[messages.asset, messages.reportedBalance, messages.reportedReserve, messages.reportedAsOf]} rows={detail.snapshots.map((snapshot) => [snapshot.assetCode, amount(snapshot.reportedAvailableBalance), amount(snapshot.reportedReserveBalance), snapshot.asOf.slice(0, 10)])}/>}</CardContent></Card>
    <Card className="mb-5"><CardHeader><CardTitle>{messages.reserveRules}</CardTitle></CardHeader><CardContent>{detail.reserveRules.length === 0 && detail.reserveLots.length === 0 ? <EmptyState>{messages.noReserveInformation}</EmptyState> : <div className="grid gap-4"><Table headers={[messages.asset, "%", messages.days, messages.effectiveFrom, messages.effectiveTo]} rows={detail.reserveRules.map((rule) => [rule.assetCode ?? "—", amount(rule.reservePercentage), rule.holdPeriodDays === null ? "—" : String(rule.holdPeriodDays), rule.effectiveFrom, rule.effectiveTo ?? "—"])}/><Table headers={[messages.asset, messages.eventDate, messages.amount, messages.expectedRelease, messages.actualReleased, messages.outstanding]} rows={detail.reserveLots.map((lot) => [lot.assetCode, lot.holdDate, amount(lot.amount), lot.expectedReleaseDate ?? "—", amount(lot.released), amount(lot.outstanding)])}/></div>}</CardContent></Card>
    <AccountDeleteAction account={detail.account} messages={messages}/>
  </div>;
}

function Info({ label, value }: { label: string; value: ReactNode }) { return <div><dt className="ui-definition-label">{label}</dt><dd className="ui-definition-value">{value}</dd></div>; }
function Table({ headers, rows }: { headers: string[]; rows: string[][] }) { if (rows.length === 0) return null; return <div className="ui-table-shell business-data-table"><div className="ui-table-scroll"><table className="ui-table"><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{row.map((value, column) => <td key={column}>{value}</td>)}</tr>)}</tbody></table></div></div>; }
function amount(value: string | null | undefined) { if (value === null || value === undefined) return "—"; try { return new Decimal(value).toFixed(); } catch { return value; } }
