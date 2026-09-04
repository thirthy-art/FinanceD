import { cookies } from "next/headers";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/src/db";
import {
  reconciliationImports,
  reconciliationMatches,
  reconciliationRunItems,
  reconciliationRuns,
  reconciliationTransactions,
} from "@/src/db/schema";
import { getActiveCompanyForPage } from "@/src/lib/active-company-page";
import CompanySelectionRequired from "@/src/components/CompanySelectionRequired";
import { computeCoverage } from "@/src/lib/reconciliation";
import { resolveLocale } from "@/src/i18n/index";
import { LOCALE_COOKIE } from "@/src/i18n/types";
import ReconciliationClient from "./ReconciliationClient";
import type { DisplayedReconciliationRun, UiImport, UiTransaction } from "./types";
import type { ReconciliationTransaction } from "@/src/lib/reconciliation/types";

export const dynamic = "force-dynamic";

export default async function ReconciliationPage() {
  const cookieStore = await cookies();
  const locale = resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value);
  const company = await getActiveCompanyForPage();
  if (!company) return <CompanySelectionRequired locale={locale} />;
  const db = getDb();
  const imports = await db
    .select({
      id: reconciliationImports.id,
      source: reconciliationImports.sourceKind,
      originalFilename: reconciliationImports.originalFilename,
      rowCount: reconciliationImports.rowCount,
      createdAt: reconciliationImports.createdAt,
    })
    .from(reconciliationImports)
    .where(eq(reconciliationImports.companyId, company.id))
    .orderBy(desc(reconciliationImports.createdAt), desc(reconciliationImports.id));

  const [latestRun] = await db
    .select({
      id: reconciliationRuns.id,
      playerLedgerImportId: reconciliationRuns.playerLedgerImportId,
      pspImportId: reconciliationRuns.pspImportId,
      updatedAt: reconciliationRuns.updatedAt,
    })
    .from(reconciliationRuns)
    .where(and(
      eq(reconciliationRuns.companyId, company.id),
      eq(reconciliationRuns.status, "completed")
    ))
    .orderBy(desc(reconciliationRuns.updatedAt), desc(reconciliationRuns.id))
    .limit(1);

  const txRows = latestRun
    ? await db
        .select({
          id: reconciliationTransactions.id,
          source: reconciliationTransactions.source,
          externalId: reconciliationTransactions.externalId,
          playerId: reconciliationTransactions.playerId,
          transactionType: reconciliationTransactions.transactionType,
          amount: reconciliationTransactions.amount,
          currency: reconciliationTransactions.currency,
          eventDate: reconciliationTransactions.eventDate,
          reference: reconciliationTransactions.reference,
          status: reconciliationTransactions.status,
          statusProvided: reconciliationTransactions.statusProvided,
          matchStatus: reconciliationRunItems.matchStatus,
        })
        .from(reconciliationRunItems)
        .innerJoin(
          reconciliationTransactions,
          eq(reconciliationRunItems.transactionId, reconciliationTransactions.id)
        )
        .where(and(
          eq(reconciliationRunItems.companyId, company.id),
          eq(reconciliationRunItems.runId, latestRun.id),
          eq(reconciliationTransactions.companyId, company.id)
        ))
        .orderBy(reconciliationTransactions.id)
    : [];

  const matchRows = latestRun
    ? await db
        .select({
          playerTransactionId: reconciliationMatches.playerTransactionId,
          pspTransactionId: reconciliationMatches.pspTransactionId,
        })
        .from(reconciliationMatches)
        .where(and(
          eq(reconciliationMatches.companyId, company.id),
          eq(reconciliationMatches.runId, latestRun.id)
        ))
    : [];
  const matchByTx = new Map<number, number>();
  for (const m of matchRows) {
    matchByTx.set(m.playerTransactionId, m.pspTransactionId);
    matchByTx.set(m.pspTransactionId, m.playerTransactionId);
  }

  const transactions: UiTransaction[] = txRows.map((r) => ({
    id: r.id,
    source: r.source,
    externalId: r.externalId,
    playerId: r.playerId,
    reference: r.reference,
    type: r.transactionType,
    amount: String(r.amount),
    currency: String(r.currency),
    eventDate: r.eventDate,
    status: r.status,
    statusProvided: r.statusProvided,
    matchStatus: r.matchStatus,
    linkedTransactionId: matchByTx.get(r.id) ?? null,
  }));

  const canonical: ReconciliationTransaction[] = transactions.map((tx) => ({
    source: tx.source,
    externalId: tx.externalId,
    playerId: tx.playerId,
    transactionType: tx.type,
    amount: tx.amount,
    currency: tx.currency,
    eventDate: tx.eventDate,
    reference: tx.reference,
    status: tx.status,
    statusProvided: tx.statusProvided,
  }));
  const coverage = computeCoverage(
    canonical.filter((tx) => tx.source === "player_ledger"),
    canonical.filter((tx) => tx.source === "psp_transactions")
  );

  const matchedPairs = matchRows.length;
  const unmatchedCount = transactions.filter((tx) => tx.matchStatus === "unmatched").length;
  const ambiguousCount = transactions.filter((tx) => tx.matchStatus === "ambiguous").length;

  const uiImports: UiImport[] = imports.map((row) => ({
    id: row.id,
    source: row.source,
    originalFilename: row.originalFilename,
    rowCount: row.rowCount,
    createdAt: row.createdAt.toISOString(),
  }));

  const displayedRun: DisplayedReconciliationRun | null = latestRun
    ? (() => {
        const playerLedgerImport = imports.find(
          (entry) => entry.id === latestRun.playerLedgerImportId
        );
        const pspImport = imports.find((entry) => entry.id === latestRun.pspImportId);
        if (!playerLedgerImport || !pspImport) return null;
        return {
          id: latestRun.id,
          playerLedgerImportId: latestRun.playerLedgerImportId,
          pspImportId: latestRun.pspImportId,
          playerLedgerFilename: playerLedgerImport.originalFilename,
          pspFilename: pspImport.originalFilename,
          updatedAt: latestRun.updatedAt.toISOString(),
        };
      })()
    : null;

  return (
    <ReconciliationClient
      key={company.id}
      transactions={transactions}
      imports={uiImports}
      displayedRun={displayedRun}
      coverage={coverage}
      matchedPairs={matchedPairs}
      unmatchedCount={unmatchedCount}
      ambiguousCount={ambiguousCount}
      hasLedger={imports.some((imp) => imp.source === "player_ledger")}
      hasPsp={imports.some((imp) => imp.source === "psp_transactions")}
    />
  );
}
