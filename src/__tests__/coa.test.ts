import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "dotenv/config";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import * as schema from "@/src/db/schema";
import { selectableExpenseAccounts } from "@/src/lib/coa-hierarchy";
import { EXPENSE_ACCOUNT_SEED, seedExpenseAccounts } from "@/src/db/seed-coa";

const DEMO_ACCOUNTS = [
  { code: "1000", name: "Cash" },
  { code: "1200", name: "Accounts Receivable" },
  { code: "2000", name: "Accounts Payable" },
  { code: "2100", name: "VAT Payable" },
  { code: "4000", name: "Operating Expenses" },
  { code: "4100", name: "Office Supplies" },
  { code: "4200", name: "Professional Services" },
  { code: "4300", name: "Travel & Entertainment" },
  { code: "5000", name: "Revenue" },
] as const;

const EXPECTED_HEADERS = [
  ["500", "Direct Trading Costs", null],
  ["5000", "Direct Trading Costs", "500"],
  ["50000", "Direct Trading Costs", "5000"],
  ["520", "Partnership Expenses", null],
  ["5200", "Affiliate-IB Costs", "520"],
  ["52000", "Affiliate-IB Costs", "5200"],
  ["600", "Online Marketing Expenses", null],
  ["6000", "Online Marketing Expenses", "600"],
  ["60000", "Online Marketing Expenses", "6000"],
  ["610", "Offline Marketing Expenses", null],
  ["6100", "Offline Marketing Expenses", "610"],
  ["61000", "Offline Marketing Expenses", "6100"],
  ["620", "HR Expenses", null],
  ["6200", "Payroll", "620"],
  ["62000", "Salaries", "6200"],
  ["62010", "Subcontractors", "6200"],
  ["6210", "Staff Costs", "620"],
  ["62100", "Staff Costs", "6210"],
  ["630", "IT Expenses", null],
  ["6300", "Telecommunications", "630"],
  ["63000", "Telecommunications", "6300"],
  ["6310", "Licenses & Tech Support", "630"],
  ["63100", "Licenses & Tech Support", "6310"],
  ["6320", "Other IT Costs", "630"],
  ["63200", "Other IT Costs", "6320"],
  ["640", "Operational Expenses", null],
  ["6400", "Travelling & Entertainment", "640"],
  ["64000", "Travelling & Entertainment", "6400"],
  ["6430", "Office Admin. Costs", "640"],
  ["64300", "Office Admin. Costs", "6430"],
  ["6440", "Insurances", "640"],
  ["64400", "Insurances", "6440"],
  ["6450", "Depreciation", "640"],
  ["64500", "Depreciation", "6450"],
  ["6460", "Other Expenses", "640"],
  ["64600", "Other Expenses", "6460"],
  ["650", "Professional Expenses", null],
  ["6500", "Professional Fees", "650"],
  ["65000", "Professional Fees", "6500"],
  ["6550", "Other Professional Services", "650"],
  ["65500", "Other Professional Services", "6550"],
  ["700", "Finance Income and Expenses", null],
  ["7010", "Finance Expenses", "700"],
  ["70100", "Finance Expenses", "7010"],
  ["7020", "Exchange Rate Difference", "700"],
  ["70200", "Client TB", "7020"],
  ["70210", "Legal TB", "7020"],
  ["800", "Taxation", null],
  ["8000", "Taxation", "800"],
  ["80000", "Taxation", "8000"],
] as const;

const accountFixture = EXPENSE_ACCOUNT_SEED.map((definition, index) => ({
  id: index + 1,
  code: definition.code,
  name: definition.name,
  type: definition.type,
  isActive: definition.isActive,
  isPosting: definition.isPosting,
  parentId: definition.parentCode
    ? EXPENSE_ACCOUNT_SEED.findIndex((candidate) => candidate.code === definition.parentCode) + 1
    : null,
}));

describe("Chart of Accounts hierarchy", () => {
  it("contains the complete active, non-posting expense header hierarchy", () => {
    const headers = EXPENSE_ACCOUNT_SEED.filter((account) => !account.isPosting);
    expect(headers.map((account) => [account.code, account.name, account.parentCode])).toEqual(EXPECTED_HEADERS);
    expect(headers).toHaveLength(50);
    expect(headers.every((account) => account.type === "expense" && account.isActive && !account.isPosting)).toBe(true);
  });

  it("contains exactly the two required six-digit cleaning posting accounts under 64300", () => {
    const postingAccounts = EXPENSE_ACCOUNT_SEED.filter((account) => account.isPosting);
    expect(postingAccounts).toEqual([
      { code: "643070", name: "Cleaning Expenses", parentCode: "64300", type: "expense", isActive: true, isPosting: true },
      { code: "643140", name: "Cleaning Supplies", parentCode: "64300", type: "expense", isActive: true, isPosting: true },
    ]);
    expect(postingAccounts.every((account) => /^\d{6}$/.test(account.code))).toBe(true);
  });

  it("keeps the invoice selector limited to active posting expense accounts", () => {
    const codes = selectableExpenseAccounts([
      ...accountFixture,
      { id: 1000, code: "999999", name: "Inactive expense", type: "expense", parentId: null, isPosting: true, isActive: false },
      { id: 1001, code: "999998", name: "Active asset", type: "asset", parentId: null, isPosting: true, isActive: true },
    ]).map((account) => account.code);
    expect(codes).toEqual(["643070", "643140"]);
  });

  it("removes only the nine exact demo account pairs in migration 0003 and guards references", () => {
    const sql = readFileSync(new URL("../../drizzle/0003_remove_demo_accounts.sql", import.meta.url), "utf8");
    for (const account of DEMO_ACCOUNTS) {
      expect(sql).toContain(`('${account.code}', '${account.name}')`);
    }
    expect(sql).toContain('WHERE ("code", "name") IN (VALUES');
    expect(sql).toContain('"supplier_invoices"."expense_account_id" = demo."id"');
    expect(sql).toContain("RAISE EXCEPTION 'Cannot remove demo chart of accounts code %");
    expect(sql).not.toMatch(/\bLIKE\b|regexp_replace/i);
  });

  it("does not seed any of the nine exact demo account pairs", () => {
    const seededAccounts: ReadonlyArray<{ code: string; name: string }> = EXPENSE_ACCOUNT_SEED;
    for (const demo of DEMO_ACCOUNTS) {
      expect(seededAccounts.some((account) => account.code === demo.code && account.name === demo.name)).toBe(false);
    }
  });
});

const HAS_DB = Boolean(process.env.DATABASE_URL);
let pool: Pool;

describe("expense account seed", () => {
  beforeAll(async () => {
    if (!HAS_DB) return;
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });
  afterAll(async () => { if (pool) await pool.end(); });

  it.skipIf(!HAS_DB)("creates the full hierarchy once and no demo accounts", async () => {
    const db = drizzle(pool, { schema });
    const [company] = await db.insert(schema.companies).values({ name: `CoA Seed Test ${Date.now()}` }).returning();
    try {
      await seedExpenseAccounts(db, company.id);
      await seedExpenseAccounts(db, company.id);
      const rows = await db.select().from(schema.chartOfAccounts).where(eq(schema.chartOfAccounts.companyId, company.id));
      expect(rows).toHaveLength(EXPENSE_ACCOUNT_SEED.length);
      expect(rows.filter((account) => account.isPosting).map((account) => account.code).sort()).toEqual(["643070", "643140"]);
      for (const demo of DEMO_ACCOUNTS) {
        expect(rows.some((account) => account.code === demo.code && account.name === demo.name)).toBe(false);
      }

      const rowByCode = new Map(rows.map((account) => [account.code, account]));
      for (const definition of EXPENSE_ACCOUNT_SEED) {
        expect(rowByCode.get(definition.code)?.parentId ?? null).toBe(
          definition.parentCode ? rowByCode.get(definition.parentCode)?.id : null,
        );
      }
    } finally {
      await db.delete(schema.chartOfAccounts).where(eq(schema.chartOfAccounts.companyId, company.id));
      await db.delete(schema.companies).where(eq(schema.companies.id, company.id));
    }
  });

  it.skipIf(!HAS_DB)("does not overwrite an existing user account with the same code", async () => {
    const db = drizzle(pool, { schema });
    const [company] = await db.insert(schema.companies).values({ name: `CoA Existing Test ${Date.now()}` }).returning();
    try {
      const [existing] = await db.insert(schema.chartOfAccounts).values({
        companyId: company.id,
        code: "500",
        name: "User-defined direct costs",
        type: "expense",
        isActive: false,
        isPosting: true,
      }).returning();
      await seedExpenseAccounts(db, company.id);
      const [preserved] = await db.select().from(schema.chartOfAccounts).where(and(
        eq(schema.chartOfAccounts.companyId, company.id),
        eq(schema.chartOfAccounts.code, "500"),
      ));
      expect(preserved).toMatchObject({ id: existing.id, name: "User-defined direct costs", isActive: false, isPosting: true });
    } finally {
      await db.delete(schema.chartOfAccounts).where(eq(schema.chartOfAccounts.companyId, company.id));
      await db.delete(schema.companies).where(eq(schema.companies.id, company.id));
    }
  });
});
