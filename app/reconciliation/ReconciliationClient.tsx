"use client";

import { useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Messages } from "@/src/i18n/types";
import type { CoverageSummary } from "@/src/lib/reconciliation/coverage";
import type { DisplayedReconciliationRun, UiImport, UiTransaction } from "./types";
import type { ReconciliationSource } from "@/src/lib/reconciliation/types";
import { coverageDifferenceKind } from "@/src/lib/reconciliation/coverage";
import { Decimal } from "@/src/lib/decimal";
import { useI18n } from "@/src/i18n/context";
import {
  displayedRunPairLabel,
  shouldShowStaleResultsWarning,
} from "./result-ownership";

const ACCEPT = ".csv,.xlsx";

function formatMoney(amount: string, currency: string): string {
  try {
    return `${currency} ${new Decimal(amount).toString()}`;
  } catch {
    return `${currency} ${amount}`;
  }
}

function statusStyle(matchStatus: string) {
  if (matchStatus === "matched") return { background: "#dcfce7", color: "#166534" };
  if (matchStatus === "ambiguous") return { background: "#fef9c3", color: "#713f12" };
  return { background: "#f1f5f9", color: "#64748b" };
}

export default function ReconciliationClient({
  transactions,
  imports,
  displayedRun,
  coverage,
  matchedPairs,
  unmatchedCount,
  ambiguousCount,
  hasLedger,
  hasPsp,
}: {
  transactions: UiTransaction[];
  imports: UiImport[];
  displayedRun: DisplayedReconciliationRun | null;
  coverage: CoverageSummary;
  matchedPairs: number;
  unmatchedCount: number;
  ambiguousCount: number;
  hasLedger: boolean;
  hasPsp: boolean;
}) {
  const { t: messages } = useI18n();
  const t = messages.reconciliation;
  const router = useRouter();
  const [uploadingSource, setUploadingSource] = useState<ReconciliationSource | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<ReconciliationSource>("player_ledger");
  const ledgerImports = imports.filter((entry) => entry.source === "player_ledger");
  const pspImports = imports.filter((entry) => entry.source === "psp_transactions");
  const [playerLedgerImportId, setPlayerLedgerImportId] = useState<number | null>(
    ledgerImports[0]?.id ?? null
  );
  const [pspImportId, setPspImportId] = useState<number | null>(pspImports[0]?.id ?? null);

  async function handleFile(source: ReconciliationSource, file: File) {
    if (uploadingSource) return;
    setUploadingSource(source);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("source", source);
      const res = await fetch("/api/reconciliation/import", { method: "POST", body: form });
      const result = await res.json().catch(() => ({})) as {
        error?: string;
        importId?: number;
        reused?: boolean;
      };
      if (!res.ok) {
        setError(typeof result.error === "string" ? result.error : t.uploadError);
        return;
      }
      if (result.reused) {
        if (typeof result.importId === "number") selectImport(source, result.importId);
        setError(t.duplicateFile);
        return;
      }
      if (typeof result.importId === "number") selectImport(source, result.importId);
      router.refresh();
    } catch {
      setError(t.uploadError);
    } finally {
      setUploadingSource(null);
    }
  }

  async function handleRun() {
    if (running || playerLedgerImportId === null || pspImportId === null) return;
    setRunning(true);
    setError("");
    try {
      const res = await fetch("/api/reconciliation/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerLedgerImportId, pspImportId }),
      });
      const result = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) {
        setError(typeof result.error === "string" ? result.error : t.uploadError);
        return;
      }
      router.refresh();
    } catch {
      setError(t.uploadError);
    } finally {
      setRunning(false);
    }
  }

  function selectImport(source: ReconciliationSource, importId: number) {
    if (source === "player_ledger") setPlayerLedgerImportId(importId);
    else setPspImportId(importId);
  }

  const surplus = coverage.surplusOrShortfall;
  const differenceKind = coverageDifferenceKind(surplus);
  const coverageValue = coverage.coveragePercent !== null ? `${coverage.coveragePercent}%` : t.notApplicable;
  const transactionById = new Map(transactions.map((tx) => [tx.id, tx]));
  const showStaleResultsWarning = shouldShowStaleResultsWarning(
    displayedRun,
    playerLedgerImportId,
    pspImportId
  );

  return (
    <div>
      <Header t={t} />

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 24 }}>
        <UploadCard
          title={t.importLedgerTitle}
          desc={t.importLedgerDesc}
          buttonLabel={t.importLedgerButton}
          doneLabel={t.importLedgerDone}
          loaded={hasLedger}
          loading={uploadingSource === "player_ledger"}
          onFile={(f) => handleFile("player_ledger", f)}
        />
        <UploadCard
          title={t.importPspTitle}
          desc={t.importPspDesc}
          buttonLabel={t.importPspButton}
          doneLabel={t.importPspDone}
          loaded={hasPsp}
          loading={uploadingSource === "psp_transactions"}
          onFile={(f) => handleFile("psp_transactions", f)}
        />
      </div>

      <section style={{ marginBottom: 24 }}>
        <SectionLabel>{t.runTitle}</SectionLabel>
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 16 }}>
          <div style={{ marginBottom: 14 }}>
            <p style={{ margin: 0, fontSize: 13, color: "#475569" }}>{t.runDescription}</p>
            {(!hasLedger || !hasPsp) && (
              <p style={{ margin: "6px 0 0", fontSize: 12, color: "#d97706" }}>{t.noDataToRun}</p>
            )}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
            <ImportSelect
              label={t.selectLedgerImport}
              imports={ledgerImports}
              value={playerLedgerImportId}
              onChange={setPlayerLedgerImportId}
            />
            <ImportSelect
              label={t.selectPspImport}
              imports={pspImports}
              value={pspImportId}
              onChange={setPspImportId}
            />
            <button
              type="button"
              onClick={handleRun}
              disabled={running || playerLedgerImportId === null || pspImportId === null}
              style={{
                background: playerLedgerImportId !== null && pspImportId !== null ? "#1e3a5f" : "#cbd5e1",
                color: playerLedgerImportId !== null && pspImportId !== null ? "#fff" : "#64748b",
                padding: "10px 18px",
                border: "none",
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 600,
                cursor: playerLedgerImportId !== null && pspImportId !== null ? "pointer" : "not-allowed",
              }}
            >
              {running ? t.running : t.runButton}
            </button>
          </div>
        </div>
      </section>

      {error && (
        <div style={{ background: "#fee2e2", color: "#dc2626", border: "1px solid #fecaca", borderRadius: 6, padding: "10px 14px", fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {displayedRun && (
        <section style={{ marginBottom: 20 }}>
          <div
            style={{
              background: "#f8fafc",
              border: "1px solid #cbd5e1",
              borderRadius: 8,
              padding: "12px 14px",
              color: "#334155",
              fontSize: 13,
            }}
          >
            <span style={{ fontWeight: 700 }}>{t.resultsFor}: </span>
            <span>{displayedRunPairLabel(displayedRun)}</span>
          </div>
          {showStaleResultsWarning && (
            <div
              role="status"
              style={{
                background: "#fffbeb",
                border: "1px solid #fde68a",
                borderRadius: 8,
                color: "#92400e",
                fontSize: 13,
                marginTop: 8,
                padding: "10px 14px",
              }}
            >
              {t.selectedImportsNotReconciled}
            </div>
          )}
        </section>
      )}

      {(matchedPairs > 0 || unmatchedCount > 0 || ambiguousCount > 0) && (
        <section style={{ marginBottom: 24 }}>
          <SectionLabel>{t.summary}</SectionLabel>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            <SummaryCard label={t.matched} value={String(matchedPairs)} />
            <SummaryCard label={t.unmatched} value={String(unmatchedCount)} accent="#dc2626" />
            {ambiguousCount > 0 && <SummaryCard label={t.ambiguous} value={String(ambiguousCount)} accent="#d97706" />}
            <SummaryCard
              label={t.playerLiability}
              value={coverage.currency ? formatMoney(coverage.playerLiability, coverage.currency) : "—"}
            />
            <SummaryCard
              label={t.availableFunds}
              value={coverage.currency ? formatMoney(coverage.availableFunds, coverage.currency) : "—"}
            />
            <SummaryCard
              label={differenceKind === "surplus" ? t.surplus : differenceKind === "shortfall" ? t.shortfall : t.balanced}
              value={coverage.currency && surplus !== null ? formatMoney(surplus, coverage.currency) : "—"}
              accent={differenceKind === "surplus" ? "#166534" : differenceKind === "shortfall" ? "#b91c1c" : "#475569"}
            />
            <SummaryCard label={t.coveragePercent} value={coverageValue} accent="#1e40af" />
          </div>
          {coverage.multiCurrency && (
            <p style={{ marginTop: 10, fontSize: 12, color: "#94a3b8" }}>{t.coverageAllCurrencies}</p>
          )}
        </section>
      )}

      <section>
        <SectionLabel>{t.resultsTitle}</SectionLabel>
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <TabButton active={tab === "player_ledger"} onClick={() => setTab("player_ledger")}>
            {t.resultsLedgerTab} ({transactions.filter((tx) => tx.source === "player_ledger").length})
          </TabButton>
          <TabButton active={tab === "psp_transactions"} onClick={() => setTab("psp_transactions")}>
            {t.resultsPspTab} ({transactions.filter((tx) => tx.source === "psp_transactions").length})
          </TabButton>
        </div>

        {transactions.length === 0 ? (
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "40px 24px", textAlign: "center", color: "#94a3b8" }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{t.noDataTitle}</div>
            <div style={{ fontSize: 13 }}>{t.noDataDesc}</div>
          </div>
        ) : (
          <TransactionTable
            t={t}
            transactions={transactions.filter((tx) => tx.source === tab)}
            transactionById={transactionById}
          />
        )}
      </section>

      <section style={{ marginTop: 28 }}>
        <SectionLabel>{t.uploadsHeading}</SectionLabel>
        {imports.length === 0 ? (
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "16px", color: "#94a3b8", fontSize: 13 }}>
            {t.uploadsEmpty}
          </div>
        ) : (
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
            {imports.map((imp) => (
              <div key={imp.id} style={{ padding: "10px 14px", borderBottom: "1px solid #f1f5f9", fontSize: 13, display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "#334155", fontWeight: 500 }}>{imp.originalFilename}</span>
                <span style={{ color: "#64748b", fontSize: 12 }}>
                  {imp.source === "player_ledger" ? t.resultsLedgerTab : t.resultsPspTab} · {imp.rowCount} rows ·{" "}
                  {new Date(imp.createdAt).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Header({ t }: { t: Messages["reconciliation"] }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: "#1e3a5f", margin: 0 }}>{t.title}</h1>
      <p style={{ margin: "6px 0 0", color: "#64748b", fontSize: 13 }}>{t.subtitle}</p>
      <p style={{ margin: "8px 0 0", color: "#d97706", fontSize: 12, maxWidth: 720 }}>⚠️ {t.disclaimer}</p>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontSize: 13, fontWeight: 600, color: "#64748b", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>
      {children}
    </div>
  );
}

function SummaryCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ flex: "1 1 150px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "14px 16px", minWidth: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: accent ?? "#1e3a5f", lineHeight: 1.2 }}>{value}</div>
    </div>
  );
}

function UploadCard({
  title,
  desc,
  buttonLabel,
  doneLabel,
  loaded,
  loading,
  onFile,
}: {
  title: string;
  desc: string;
  buttonLabel: string;
  doneLabel: string;
  loaded: boolean;
  loading: boolean;
  onFile: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div style={{ flex: "1 1 260px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "16px 18px" }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#1e3a5f", marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 12, color: "#64748b", marginBottom: 12 }}>{desc}</div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        style={{ display: "none" }}
        disabled={loading}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onFile(file);
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={loading}
        style={{
          padding: "8px 14px",
          borderRadius: 6,
          fontSize: 13,
          fontWeight: 600,
          cursor: loading ? "wait" : "pointer",
          background: loading ? "#e2e8f0" : loaded ? "#dcfce7" : "#eff6ff",
          color: loading ? "#64748b" : loaded ? "#166534" : "#1e40af",
          border: "none",
        }}
      >
        {loading ? "…" : loaded ? doneLabel : buttonLabel}
      </button>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "8px 16px",
        borderRadius: 6,
        fontSize: 13,
        fontWeight: 600,
        border: active ? "1px solid #1e3a5f" : "1px solid #cbd5e1",
        background: active ? "#1e3a5f" : "#fff",
        color: active ? "#fff" : "#334155",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function TransactionTable({
  t,
  transactions,
  transactionById,
}: {
  t: Messages["reconciliation"];
  transactions: UiTransaction[];
  transactionById: Map<number, UiTransaction>;
}) {
  const isLedger = transactions[0]?.source === "player_ledger";
  return (
    <>
      {/* Desktop table */}
      <div className="cf-table-desktop" style={{ display: "none" }}>
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                {[t.colReference, t.colPlayerId, t.colType, t.colAmount, t.colCurrency, t.colDate, t.colStatus, t.matchStatus].map((h) => (
                  <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {transactions.map((tx, i) => (
                <tr key={tx.id} style={{ borderBottom: i < transactions.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                  <td style={{ padding: "11px 14px", fontSize: 13, color: "#475569" }}>{tx.externalId ?? "—"}</td>
                  <td style={{ padding: "11px 14px", fontSize: 13, color: "#64748b" }}>{tx.playerId ?? "—"}</td>
                  <td style={{ padding: "11px 14px", fontSize: 13 }}>{tx.type}</td>
                  <td style={{ padding: "11px 14px", fontWeight: 600, fontSize: 13 }}>{formatMoney(tx.amount, tx.currency)}</td>
                  <td style={{ padding: "11px 14px", fontSize: 13, color: "#64748b" }}>{tx.currency}</td>
                  <td style={{ padding: "11px 14px", fontSize: 13, color: "#64748b" }}>{tx.eventDate ?? "—"}</td>
                  <td style={{ padding: "11px 14px", fontSize: 13, color: "#64748b" }}>{tx.status ?? "—"}</td>
                  <td style={{ padding: "11px 14px" }}>
                    <MatchCell t={t} tx={tx} transactionById={transactionById} isLedger={isLedger} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile stacked cards */}
      <div className="cf-table-mobile" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {transactions.map((tx) => (
          <div key={tx.id} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "14px 16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 6 }}>
              <span style={{ fontWeight: 600, fontSize: 14, color: "#334155" }}>{tx.externalId ?? "—"}</span>
              <span style={{ fontWeight: 700, fontSize: 14, whiteSpace: "nowrap" }}>{formatMoney(tx.amount, tx.currency)}</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", fontSize: 12, color: "#64748b" }}>
              <span>{t.colType}: {tx.type}</span>
              {tx.playerId && <span>{t.colPlayerId}: {tx.playerId}</span>}
              {tx.eventDate && <span>{t.colDate}: {tx.eventDate}</span>}
              {tx.status && <span>{t.colStatus}: {tx.status}</span>}
            </div>
            <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ ...statusStyle(tx.matchStatus), padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600 }}>
                {tx.matchStatus}
              </span>
              <MatchCell t={t} tx={tx} transactionById={transactionById} isLedger={isLedger} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function MatchCell({
  t,
  tx,
  transactionById,
  isLedger,
}: {
  t: Messages["reconciliation"];
  tx: UiTransaction;
  transactionById: Map<number, UiTransaction>;
  isLedger: boolean;
}) {
  if (tx.matchStatus === "matched" && tx.linkedTransactionId !== null) {
    const linked = transactionById.get(tx.linkedTransactionId);
    if (linked) {
      return (
        <span style={{ fontSize: 12, color: "#166534", fontWeight: 500 }}>
          {isLedger ? t.matchLinkedPsp : t.matchLinkedLedger}: {linked.externalId ?? `#${linked.id}`}
        </span>
      );
    }
  }
  if (tx.matchStatus === "ambiguous") {
    return <span style={{ fontSize: 12, color: "#713f12", fontWeight: 600 }}>{t.statusAmbiguous}</span>;
  }
  return <span style={{ fontSize: 12, color: "#94a3b8" }}>{t.statusUnmatched}</span>;
}

function ImportSelect({
  label,
  imports,
  value,
  onChange,
}: {
  label: string;
  imports: UiImport[];
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <label style={{ flex: "1 1 280px", minWidth: 0, fontSize: 12, color: "#475569" }}>
      <span style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>{label}</span>
      <select
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
        disabled={imports.length === 0}
        style={{
          width: "100%",
          minWidth: 0,
          padding: "9px 10px",
          border: "1px solid #cbd5e1",
          borderRadius: 6,
          background: imports.length === 0 ? "#f1f5f9" : "#fff",
          color: "#334155",
          fontSize: 13,
        }}
      >
        {imports.length === 0 && <option value="">—</option>}
        {imports.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.originalFilename} · {entry.rowCount} rows · {new Date(entry.createdAt).toLocaleString()}
          </option>
        ))}
      </select>
    </label>
  );
}
