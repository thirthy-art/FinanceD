import "dotenv/config";
import { inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/src/db";
import * as schema from "@/src/db/schema";
import { loadDashboardSourceRows } from "@/src/lib/dashboard-source";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const db = getDb();

describe("dashboard source tenant isolation (DB)", () => {
  it.skipIf(!HAS_DB)("loads balances and reconciliation liability only for the requested company", async () => {
    const stamp = `${Date.now()}-${Math.random()}`;
    const companies = await db.insert(schema.companies).values([
      { name: `Dashboard tenant A ${stamp}`, baseCurrency: "EUR" },
      { name: `Dashboard tenant B ${stamp}`, baseCurrency: "EUR" },
    ]).returning({ id: schema.companies.id });
    const companyIds = companies.map((company) => company.id);

    try {
      for (const [index, companyId] of companyIds.entries()) {
        const [account] = await db.insert(schema.paymentAccounts).values({
          companyId,
          name: `Dashboard account ${index} ${stamp}`,
          accountType: "bank",
          clientFundsEligible: false,
        }).returning({ id: schema.paymentAccounts.id });
        await db.insert(schema.paymentAccountAssets).values({
          companyId,
          paymentAccountId: account.id,
          assetCode: "EUR",
          assetType: "fiat",
          openingAvailableBalance: index === 0 ? "100" : "900",
        });
        const imports = await db.insert(schema.reconciliationImports).values([
          { companyId, sourceKind: "player_ledger", originalFilename: `ledger-${index}.csv`, contentHash: `${stamp}-ledger-${index}` },
          { companyId, sourceKind: "psp_transactions", originalFilename: `psp-${index}.csv`, contentHash: `${stamp}-psp-${index}` },
        ]).returning({ id: schema.reconciliationImports.id, source: schema.reconciliationImports.sourceKind });
        const ledgerImportId = imports.find((row) => row.source === "player_ledger")!.id;
        const pspImportId = imports.find((row) => row.source === "psp_transactions")!.id;
        await db.insert(schema.reconciliationTransactions).values({
          companyId,
          importId: ledgerImportId,
          source: "player_ledger",
          transactionType: "deposit",
          amount: index === 0 ? "80" : "800",
          currency: "EUR",
        });
        await db.insert(schema.reconciliationRuns).values({
          companyId,
          playerLedgerImportId: ledgerImportId,
          pspImportId,
          status: "completed",
        });
      }

      const rows = await loadDashboardSourceRows(companyIds[0]);
      expect(rows.accounts).toHaveLength(1);
      expect(rows.accounts[0].companyId).toBe(companyIds[0]);
      expect(rows.openings).toHaveLength(1);
      expect(String(rows.openings[0].openingAvailableBalance)).toBe("100.000000000000000000");
      expect(rows.latestRun).not.toBeNull();
      expect(rows.liabilityRows).toHaveLength(1);
      expect(String(rows.liabilityRows[0].amount)).toBe("80.000000000000000000");
    } finally {
      await db.delete(schema.reconciliationTransactions).where(inArray(schema.reconciliationTransactions.companyId, companyIds));
      await db.delete(schema.reconciliationRuns).where(inArray(schema.reconciliationRuns.companyId, companyIds));
      await db.delete(schema.reconciliationImports).where(inArray(schema.reconciliationImports.companyId, companyIds));
      await db.delete(schema.paymentAccountAssets).where(inArray(schema.paymentAccountAssets.companyId, companyIds));
      await db.delete(schema.paymentAccounts).where(inArray(schema.paymentAccounts.companyId, companyIds));
      await db.delete(schema.companies).where(inArray(schema.companies.id, companyIds));
    }
  });
});
