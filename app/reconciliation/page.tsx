import { cookies } from "next/headers";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/src/db";
import {
  reconciliationImports,
  reconciliationMatches,
  reconciliationTransactions,
} from "@/src/db/schema";
import { getActiveCompanyForPage } from "@/src/lib/active-company-page";
import CompanySelectionRequired from "@/src/components/CompanySelectionRequired";
import { computeCoverage } from "@/src/lib/reconciliation";
import { resolveLocale, getMessages } from "@/src/i18n/index";
import { LOCALE_COOKIE } from "@/src/i18n/types";
import ReconciliationClient from "./ReconciliationClient";
import type { UiImport, UiTransaction } from "./types";
import type { ReconciliationTransaction } from "@/src/lib/reconciliation/types";

export const dynamic = "force-dynamic";

export default async function ReconciliationPage() {
  const cookieStore = await cookies();
  const locale = resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value);
  const company = await getActiveCompanyForPage();
  if (!company) return <CompanySelectionRequired locale={locale} />;
  const db = getDb();
  const { reconciliation: t } = getMessages(locale);

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
    .orderBy(desc(reconciliationImports.createdAt));

  const txRows = await db
    .select({
      id: reconciliationTransactions.id,
      source: reconciliationTransactions.source,
      externalId: reconciliationTransactions.externalId,
      playerId: reconciliationTransactions.playerId,
      transactionType: reconciliationTransactions.transactionType,
      amount: reconciliationTransactions.amount,
      currency: reconciliationTransactions.currency,
      eventDate: reconciliationTransactions.eventDate,
      status: reconciliationTransactions.status,
      matchStatus: reconciliationTransactions.matchStatus,
    })
    .from(reconciliationTransactions)
    .where(eq(reconciliationTransactions.companyId, company.id))
    .orderBy(reconciliationTransactions.id);

  const matchRows = await db
    .select({
      playerTransactionId: reconciliationMatches.playerTransactionId,
      pspTransactionId: reconciliationMatches.pspTransactionId,
    })
    .from(reconciliationMatches)
    .where(eq(reconciliationMatches.companyId, company.id));
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
    type: r.transactionType,
    amount: String(r.amount),
    currency: String(r.currency),
    eventDate: r.eventDate,
    status: r.status,
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
    reference: tx.externalId,
    status: tx.status,
  }));
  const coverage = computeCoverage(
    canonical.filter((tx) => tx.source === "player_ledger"),
    canonical.filter((tx) => tx.source === "psp_transactions")
  );

  const matchedPairs = transactions.filter((tx) => tx.matchStatus === "matched").length / 2;
  const unmatchedCount = transactions.filter((tx) => tx.matchStatus === "unmatched").length;
  const ambiguousCount = transactions.filter((tx) => tx.matchStatus === "ambiguous").length;

  const uiImports: UiImport[] = imports.map((row) => ({
    id: row.id,
    source: row.source,
    originalFilename: row.originalFilename,
    rowCount: row.rowCount,
    createdAt: row.createdAt.toISOString(),
  }));

  return (
    <ReconciliationClient
      transactions={transactions}
      imports={uiImports}
      coverage={coverage}
      matchedPairs={matchedPairs}
      unmatchedCount={unmatchedCount}
      ambiguousCount={ambiguousCount}
      hasLedger={imports.some((imp) => imp.source === "player_ledger")}
      hasPsp={imports.some((imp) => imp.source === "psp_transactions")}
    />
  );
}