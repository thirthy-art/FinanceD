import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "dotenv/config";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "@/src/db/schema";
import { selectableExpenseAccounts } from "@/src/lib/coa-hierarchy";
import { CLEANING_ACCOUNT_SEED, seedCleaningAccounts } from "@/src/db/seed-coa";

const accountFixture = CLEANING_ACCOUNT_SEED.map((definition, index) => ({
  id: index + 1,
  ...definition,
  type: "expense" as const,
  isActive: true,
  parentId: definition.parentCode ? CLEANING_ACCOUNT_SEED.findIndex((candidate) => candidate.code === definition.parentCode) + 1 : null,
}));

describe("Chart of Accounts hierarchy", () => {
  it("excludes hierarchy headers and includes both cleaning posting accounts", () => {
    const codes = selectableExpenseAccounts(accountFixture).map((account) => account.code);
    expect(codes).not.toContain("640");
    expect(codes).not.toContain("6430");
    expect(codes).not.toContain("64300");
    expect(codes).toContain("643070");
    expect(codes).toContain("643140");
  });
});

const HAS_DB = Boolean(process.env.DATABASE_URL);
let pool: Pool;

describe("cleaning account seed", () => {
  beforeAll(async () => {
    if (!HAS_DB) return;
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });
  afterAll(async () => { if (pool) await pool.end(); });

  it.skipIf(!HAS_DB)("can run repeatedly without creating duplicate accounts", async () => {
    const db = drizzle(pool, { schema });
    const [company] = await db.insert(schema.companies).values({ name: `CoA Seed Test ${Date.now()}` }).returning();
    try {
      await seedCleaningAccounts(db, company.id);
      await seedCleaningAccounts(db, company.id);
      const rows = await db.select().from(schema.chartOfAccounts).where(and(
        eq(schema.chartOfAccounts.companyId, company.id),
        inArray(schema.chartOfAccounts.code, CLEANING_ACCOUNT_SEED.map((item) => item.code)),
      ));
      expect(rows).toHaveLength(5);
    } finally {
      await db.delete(schema.chartOfAccounts).where(eq(schema.chartOfAccounts.companyId, company.id));
      await db.delete(schema.companies).where(eq(schema.companies.id, company.id));
    }
  });
});
