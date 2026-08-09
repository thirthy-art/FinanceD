// Returns the singleton company row, creating it if missing.
import { getDb } from "@/src/db";
import { companies } from "@/src/db/schema";

export async function getOrCreateCompany() {
  const db = getDb();
  const existing = await db.select().from(companies).limit(1);
  if (existing.length) return existing[0];
  const [created] = await db
    .insert(companies)
    .values({ name: "My Company", baseCurrency: "USD" })
    .returning();
  return created;
}
