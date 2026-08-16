import "dotenv/config";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { companies, chartOfAccounts, costCentres } from "./schema";

async function seed() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  // Insert company if not exists
  const [company] = await db
    .insert(companies)
    .values({ name: "My Company", baseCurrency: "USD" })
    .onConflictDoNothing()
    .returning();

  if (!company) {
    console.log("Company already seeded.");
    await pool.end();
    return;
  }

  // Minimal neutral chart of accounts
  await db.insert(chartOfAccounts).values([
    { companyId: company.id, code: "1000", name: "Cash", type: "asset" },
    { companyId: company.id, code: "1200", name: "Accounts Receivable", type: "asset" },
    { companyId: company.id, code: "1300", name: "Prepaid Expenses", type: "asset" },
    { companyId: company.id, code: "2000", name: "Accounts Payable", type: "liability" },
    { companyId: company.id, code: "2100", name: "VAT Payable", type: "liability" },
    { companyId: company.id, code: "4000", name: "Operating Expenses", type: "expense" },
    { companyId: company.id, code: "4100", name: "Office Supplies", type: "expense" },
    { companyId: company.id, code: "4200", name: "Professional Services", type: "expense" },
    { companyId: company.id, code: "4300", name: "Travel & Entertainment", type: "expense" },
    { companyId: company.id, code: "4400", name: "Cleaning Expenses", type: "expense" },
    { companyId: company.id, code: "5000", name: "Revenue", type: "revenue" },
  ]);

  // Cost centres
  await db.insert(costCentres).values([
    { companyId: company.id, code: "ADMIN", name: "Administration" },
    { companyId: company.id, code: "SALES", name: "Sales" },
    { companyId: company.id, code: "OPS", name: "Operations" },
  ]);

  console.log("Seed complete for company id:", company.id);
  await pool.end();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
