import "dotenv/config";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { companies, costCentres } from "./schema";
import { seedExpenseAccounts } from "./seed-coa";

async function seed() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });

  // Reuse existing company or create one.
  const existing = await db.select().from(companies).limit(1);
  let companyId: number;
  if (existing.length) {
    companyId = existing[0].id;
    console.log("Company already exists, id:", companyId);
  } else {
    const [company] = await db
      .insert(companies)
      .values({ name: "Demo Company", baseCurrency: "EUR" })
      .returning();
    companyId = company.id;
    console.log("Created company, id:", companyId);
  }

  // Chart of accounts: unique on (companyId, code) prevents duplicates.
  await seedExpenseAccounts(db, companyId);

  // Cost centres: unique on (companyId, code) prevents duplicates.
  await db
    .insert(costCentres)
    .values([
      { companyId, code: "ADMIN", name: "Administration" },
      { companyId, code: "SALES", name: "Sales" },
      { companyId, code: "OPS", name: "Operations" },
    ])
    .onConflictDoNothing();

  console.log("Seed complete for company id:", companyId);
  await pool.end();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
