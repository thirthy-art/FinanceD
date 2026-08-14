import "dotenv/config";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { companies, chartOfAccounts, costCentres } from "./schema";

async function seed() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  // Reuse existing company or create one
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

  // Chart of accounts — unique on (companyId, code) prevents duplicates
  await db
    .insert(chartOfAccounts)
    .values([
      { companyId, code: "1000", name: "Cash", type: "asset" as const },
      { companyId, code: "1200", name: "Accounts Receivable", type: "asset" as const },
      { companyId, code: "2000", name: "Accounts Payable", type: "liability" as const },
      { companyId, code: "2100", name: "VAT Payable", type: "liability" as const },
      { companyId, code: "4000", name: "Operating Expenses", type: "expense" as const },
      { companyId, code: "4100", name: "Office Supplies", type: "expense" as const },
      { companyId, code: "4200", name: "Professional Services", type: "expense" as const },
      { companyId, code: "4300", name: "Travel & Entertainment", type: "expense" as const },
      { companyId, code: "5000", name: "Revenue", type: "revenue" as const },
    ])
    .onConflictDoNothing();

  // Cost centres — unique on (companyId, code) prevents duplicates
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
