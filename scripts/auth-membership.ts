import "dotenv/config";

import { eq, sql } from "drizzle-orm";
import { closeDb, getDb } from "../src/db";
import { authUsers, companies } from "../src/db/schema";
import {
  grantCompanyMembership,
  revokeCompanyMembership,
} from "../src/lib/company-membership-admin";

async function main() {
  const [action, rawEmail, rawCompanyId] = process.argv.slice(2);
  const email = rawEmail?.trim().toLowerCase();
  const companyId = rawCompanyId && /^\d+$/.test(rawCompanyId) ? Number(rawCompanyId) : null;
  if ((action !== "grant" && action !== "revoke") || !email || !companyId || !Number.isSafeInteger(companyId)) {
    throw new Error("Usage: npm run auth:grant -- <email> <companyId> or npm run auth:revoke -- <email> <companyId>");
  }

  const db = getDb();
  const [user] = await db
    .select({ id: authUsers.id, email: authUsers.email })
    .from(authUsers)
    .where(sql`lower(${authUsers.email}) = ${email}`)
    .limit(1);
  if (!user) throw new Error(`No signed-in Auth.js user exists for ${email}.`);

  const [company] = await db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  if (!company) throw new Error(`Company ${companyId} does not exist.`);

  if (action === "grant") {
    const result = await grantCompanyMembership(db, user.id, company.id);
    console.log(result.granted
      ? `Granted ${email} access to ${company.name} (${company.id}).`
      : `${email} already has access to ${company.name} (${company.id}).`);
  } else {
    const result = await revokeCompanyMembership(db, user.id, company.id);
    console.log(result.revoked
      ? `Revoked ${email} access to ${company.name} (${company.id}).`
      : `${email} did not have access to ${company.name} (${company.id}).`);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Membership update failed.");
    process.exitCode = 1;
  })
  .finally(closeDb);
