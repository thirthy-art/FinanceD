"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Messages } from "@/src/i18n";
import type { AssetType, BalanceDirection, PaymentEventType, PaymentAccountDeletionImpact } from "@/src/lib/payment-ledger";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Select } from "@/src/components/ui/select";
import { Textarea } from "@/src/components/ui/textarea";
import { Alert } from "@/src/components/ui/feedback";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";

export interface EditablePaymentEvent {
  id: number;
  eventDate: string;
  eventType: PaymentEventType;
  balanceDirection: BalanceDirection;
  balanceAmount: string;
  balanceAssetCode: string;
  balanceAssetType: AssetType;
  providerEventId: string | null;
  reference: string | null;
}

type EditDraft = Omit<EditablePaymentEvent, "id" | "providerEventId">;
type Mode = { kind: "edit" | "review" | "delete"; event: EditablePaymentEvent } | null;
const EVENT_TYPES: PaymentEventType[] = ["deposit", "withdrawal", "refund", "chargeback", "fee", "adjustment", "settlement", "transfer", "reserve_hold", "reserve_release", "conversion", "unknown"];
const DIRECTIONS: BalanceDirection[] = ["credit", "debit", "none"];

export function TransactionActions({ accountName, events, messages }: { accountName: string; events: EditablePaymentEvent[]; messages: Messages["paymentAccounts"] }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(null);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const beginEdit = (event: EditablePaymentEvent) => { setDraft({ eventDate: event.eventDate, eventType: event.eventType, balanceDirection: event.balanceDirection, balanceAmount: event.balanceAmount, balanceAssetCode: event.balanceAssetCode, balanceAssetType: event.balanceAssetType, reference: event.reference }); setMode({ kind: "edit", event }); setError(""); };
  const close = () => { if (!busy) { setMode(null); setDraft(null); setError(""); } };

  async function confirmEdit() {
    if (!mode || mode.kind !== "review" || !draft || busy) return;
    setBusy(true); setError("");
    const response = await fetch(`/api/payment-events/${mode.event.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
    const result = await response.json() as { error?: string };
    if (!response.ok) { setError(result.error ?? messages.transactionChangeFailed); setBusy(false); return; }
    setBusy(false); close(); router.refresh();
  }

  async function confirmDelete() {
    if (!mode || mode.kind !== "delete" || busy) return;
    setBusy(true); setError("");
    const response = await fetch(`/api/payment-events/${mode.event.id}`, { method: "DELETE" });
    const result = await response.json() as { error?: string };
    if (!response.ok) { setError(result.error ?? messages.transactionDeleteFailed); setBusy(false); return; }
    setBusy(false); close(); router.refresh();
  }

  return <>
    <div className="ui-table-shell business-data-table"><div className="ui-table-scroll"><table className="ui-table"><thead><tr>
      <th>{messages.eventDate}</th><th>{messages.eventType}</th><th>{messages.amount}</th><th>{messages.providerEventId}</th><th>{messages.actions}</th>
    </tr></thead><tbody>{events.map((event) => <tr key={event.id}>
      <td>{event.eventDate}</td><td>{messages.eventTypeLabels[event.eventType]}</td><td>{messages.directionLabels[event.balanceDirection]} {event.balanceAmount} {event.balanceAssetCode}</td><td>{event.providerEventId ?? "—"}</td>
      <td><div className="flex min-w-max flex-wrap gap-2"><Button size="sm" variant="secondary" onClick={() => beginEdit(event)}>{messages.editTransaction}</Button><Button size="sm" variant="destructive" onClick={() => { setMode({ kind: "delete", event }); setError(""); }}>{messages.deleteTransaction}</Button></div></td>
    </tr>)}</tbody></table></div></div>

    {mode && <div className="ui-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) close(); }}><div role="dialog" aria-modal="true" aria-labelledby="payment-event-dialog-title" className="ui-dialog">
      {mode.kind === "edit" && draft && <>
        <h2 id="payment-event-dialog-title" className="ui-dialog-title">{messages.editTransaction}</h2>
        <p className="mb-4 text-sm text-[var(--muted-foreground)]">{messages.editBusinessFactsOnly}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={messages.eventDate}><Input type="date" value={draft.eventDate} onChange={(e) => setDraft({ ...draft, eventDate: e.target.value })}/></Field>
          <Field label={messages.eventType}><Select value={draft.eventType} onChange={(e) => setDraft({ ...draft, eventType: e.target.value as PaymentEventType })}>{EVENT_TYPES.map((type) => <option key={type} value={type}>{messages.eventTypeLabels[type]}</option>)}</Select></Field>
          <Field label={messages.direction}><Select value={draft.balanceDirection} onChange={(e) => setDraft({ ...draft, balanceDirection: e.target.value as BalanceDirection })}>{DIRECTIONS.map((direction) => <option key={direction} value={direction}>{messages.directionLabels[direction]}</option>)}</Select></Field>
          <Field label={messages.amount}><Input inputMode="decimal" value={draft.balanceAmount} onChange={(e) => setDraft({ ...draft, balanceAmount: e.target.value })}/></Field>
          <Field label={messages.asset}><Input value={draft.balanceAssetCode} maxLength={20} onChange={(e) => setDraft({ ...draft, balanceAssetCode: e.target.value })}/></Field>
          <Field label={messages.assetType}><Select value={draft.balanceAssetType} onChange={(e) => setDraft({ ...draft, balanceAssetType: e.target.value as AssetType })}><option value="fiat">{messages.fiat}</option><option value="crypto">{messages.crypto}</option></Select></Field>
          <Field label={messages.reference} wide><Textarea value={draft.reference ?? ""} onChange={(e) => setDraft({ ...draft, reference: e.target.value || null })}/></Field>
        </div>
        <div className="ui-dialog-actions"><Button variant="secondary" onClick={close}>{messages.cancel}</Button><Button onClick={() => setMode({ kind: "review", event: mode.event })}>{messages.reviewChanges}</Button></div>
      </>}
      {mode.kind === "review" && draft && <>
        <h2 id="payment-event-dialog-title" className="ui-dialog-title">{messages.confirmTransactionChanges}</h2>
        <p className="mb-3 text-sm text-[var(--muted-foreground)]">{messages.changedValues}</p>
        <dl className="grid gap-3">{changes(mode.event, draft, messages).map((change) => <div key={change.label}><dt className="ui-definition-label">{change.label}</dt><dd className="ui-definition-value break-words">{change.before} → {change.after}</dd></div>)}</dl>
        {error && <Alert tone="error" className="mt-4">{error}</Alert>}
        <div className="ui-dialog-actions"><Button variant="secondary" disabled={busy} onClick={() => setMode({ kind: "edit", event: mode.event })}>{messages.back}</Button><Button disabled={busy || changes(mode.event, draft, messages).length === 0} onClick={confirmEdit}>{busy ? messages.saving : messages.confirmChanges}</Button></div>
      </>}
      {mode.kind === "delete" && <>
        <h2 id="payment-event-dialog-title" className="ui-dialog-title ui-dialog-title-danger">{messages.deleteTransactionQuestion}</h2>
        <div className="my-4 rounded-md border border-[var(--destructive-border)] bg-[var(--destructive-muted)] p-4 text-sm">
          <strong>{accountName}</strong><div>{mode.event.eventDate}</div><div>{messages.eventTypeLabels[mode.event.eventType]}</div><div>{mode.event.balanceAssetCode} {mode.event.balanceAmount}</div>{mode.event.providerEventId && <div>{messages.providerEventId}: {mode.event.providerEventId}</div>}
        </div>
        <p className="text-sm">{messages.transactionDeletePermanent}</p>{error && <Alert tone="error" className="mt-4">{error}</Alert>}
        <div className="ui-dialog-actions"><Button variant="secondary" disabled={busy} onClick={close}>{messages.cancel}</Button><Button variant="destructive" disabled={busy} onClick={confirmDelete}>{busy ? messages.deleting : messages.deleteTransaction}</Button></div>
      </>}
    </div></div>}
  </>;
}

export function AccountDangerZone({ account, impact, messages }: { account: { id: number; name: string }; impact: PaymentAccountDeletionImpact; messages: Messages["paymentAccounts"] }) {
  const router = useRouter(); const [open, setOpen] = useState(false); const [confirmation, setConfirmation] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function remove() {
    if (confirmation !== account.name || busy) return; setBusy(true); setError("");
    const response = await fetch(`/api/payment-accounts/${account.id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmationName: confirmation }) });
    const result = await response.json() as { error?: string };
    if (!response.ok) { setError(result.error ?? messages.accountDeleteFailed); setBusy(false); return; }
    router.push("/reconciliation/payment-accounts"); router.refresh();
  }
  return <Card className="border-[var(--destructive-border)]"><CardHeader><CardTitle className="text-[var(--destructive)]">{messages.dangerZone}</CardTitle></CardHeader><CardContent><p className="mb-4 text-sm">{messages.accountDeletePermanent}</p><Button variant="destructive" onClick={() => { setOpen(true); setError(""); }}>{messages.deleteNamedAccount.replace("{name}", account.name)}</Button></CardContent>
    {open && <div className="ui-dialog-backdrop" role="presentation"><div role="dialog" aria-modal="true" aria-labelledby="delete-account-title" className="ui-dialog">
      <h2 id="delete-account-title" className="ui-dialog-title ui-dialog-title-danger">{messages.deleteNamedAccount.replace("{name}", account.name)}</h2><p className="mb-4 text-sm">{messages.accountDeletePermanent}</p>
      <dl className="grid grid-cols-2 gap-3 rounded-md border border-[var(--border)] p-4 text-sm"><Impact label={messages.openingBalancesAssets} value={impact.openings}/><Impact label={messages.transactionsPaymentEvents} value={impact.transactions}/><Impact label={messages.balanceSnapshots} value={impact.snapshots}/><Impact label={messages.feeRulesCount} value={impact.feeRules}/><Impact label={messages.reserveRulesCount} value={impact.reserveRules}/><Impact label={messages.accountImports} value={impact.imports}/></dl>
      <label className="ui-label mt-4 block">{messages.typeAccountName.replace("{name}", account.name)}<Input className="mt-1" value={confirmation} autoComplete="off" onChange={(e) => setConfirmation(e.target.value)}/></label>
      {error && <Alert tone="error" className="mt-4">{error}</Alert>}<div className="ui-dialog-actions"><Button variant="secondary" disabled={busy} onClick={() => { setOpen(false); setConfirmation(""); setError(""); }}>{messages.cancel}</Button><Button variant="destructive" disabled={busy || confirmation !== account.name} onClick={remove}>{busy ? messages.deleting : messages.deleteNamedAccountPermanently.replace("{name}", account.name)}</Button></div>
    </div></div>}
  </Card>;
}

function Field({ label, wide = false, children }: { label: string; wide?: boolean; children: React.ReactNode }) { return <label className={`ui-label ${wide ? "sm:col-span-2" : ""}`}>{label}<span className="mt-1 block">{children}</span></label>; }
function Impact({ label, value }: { label: string; value: number }) { return <div><dt className="ui-definition-label">{label}</dt><dd className="ui-definition-value">{value}</dd></div>; }
function changes(event: EditablePaymentEvent, draft: EditDraft, messages: Messages["paymentAccounts"]) {
  const values: Array<[string, string | null, string | null]> = [[messages.eventDate, event.eventDate, draft.eventDate], [messages.eventType, messages.eventTypeLabels[event.eventType], messages.eventTypeLabels[draft.eventType]], [messages.direction, messages.directionLabels[event.balanceDirection], messages.directionLabels[draft.balanceDirection]], [messages.amount, `${event.balanceAssetCode} ${event.balanceAmount}`, `${draft.balanceAssetCode} ${draft.balanceAmount}`], [messages.assetType, messages[event.balanceAssetType], messages[draft.balanceAssetType]], [messages.reference, event.reference, draft.reference]];
  return values.filter(([, before, after]) => (before ?? "") !== (after ?? "")).map(([label, before, after]) => ({ label, before: before || "—", after: after || "—" }));
}
