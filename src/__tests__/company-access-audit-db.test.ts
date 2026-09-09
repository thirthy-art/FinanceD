import { afterAll, afterEach, describe, expect, it } from "vitest";
import "dotenv/config";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/src/db/schema";
import {
  claimPendingCompanyAccess,
  grantCompanyAccess,
} from "@/src/lib/company-access-provisioning";
import {
  listCompanyAccessHistory,
  reconstructAccessPeriods,
} from "@/src/lib/company-access-history";
import {
  grantCompanyMembership,
  revokeCompanyMembership,
} from "@/src/lib/company-membership-admin";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const pool = HAS_DB ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;
const db = pool ? drizzle(pool, { schema }) : null;
const companyIds: number[] = [];
const userIds: string[] = [];

async function createCompany(name: string) {
  if (!db) throw new Error("Database unavailable.");
  const [company] = await db.insert(schema.companies).values({ name }).returning({
    id: schema.companies.id,
    name: schema.companies.name,
  });
  companyIds.push(company.id);
  return company;
}

async function createUser(email: string) {
  if (!db) throw new Error("Database unavailable.");
  const id = `access-audit-${crypto.randomUUID()}`;
  await db.insert(schema.authUsers).values({ id, email });
  userIds.push(id);
  return { id, email };
}

afterEach(async () => {
  if (!db) return;
  if (companyIds.length > 0) {
    await db.delete(schema.companyAccessEvents)
      .where(inArray(schema.companyAccessEvents.companyId, companyIds));
    await db.delete(schema.companyAccessInvites)
      .where(inArray(schema.companyAccessInvites.companyId, companyIds));
    await db.delete(schema.companyMembers)
      .where(inArray(schema.companyMembers.companyId, companyIds));
    await db.delete(schema.companies).where(inArray(schema.companies.id, companyIds));
  }
  if (userIds.length > 0) {
    await db.delete(schema.authUsers).where(inArray(schema.authUsers.id, userIds));
  }
  companyIds.length = 0;
  userIds.length = 0;
});

afterAll(async () => {
  await pool?.end();
});

describe("company access audit database integration", () => {
  it.skipIf(!HAS_DB)("records one event for one effective pending invite", async () => {
    if (!db) return;
    const company = await createCompany(`Audit pending ${crypto.randomUUID()}`);
    const email = `pending-${crypto.randomUUID()}@example.com`;
    await grantCompanyAccess(db, { companyId: company.id, email: ` ${email.toUpperCase()} ` });
    await grantCompanyAccess(db, { companyId: company.id, email });
    const events = await listCompanyAccessHistory(db, { companyId: company.id, email });
    expect(events.map((row) => row.eventType)).toEqual(["invite_created"]);
    expect(events[0]).toMatchObject({ actor: "admin", source: "operator_cli" });
  });

  it.skipIf(!HAS_DB)("records one immediate grant for an existing user", async () => {
    if (!db) return;
    const company = await createCompany(`Audit immediate ${crypto.randomUUID()}`);
    const user = await createUser(`existing-${crypto.randomUUID()}@example.com`);
    await grantCompanyAccess(db, { companyId: company.id, email: user.email });
    await grantCompanyAccess(db, { companyId: company.id, email: user.email });
    const events = await listCompanyAccessHistory(db, { companyId: company.id, email: user.email });
    expect(events.map((row) => row.eventType)).toEqual(["membership_granted"]);
    expect(events[0]).toMatchObject({ actor: "admin", source: "operator_cli", currentAccess: true });
  });

  it.skipIf(!HAS_DB)("claims an OAuth invite and grants membership exactly once", async () => {
    if (!db) return;
    const company = await createCompany(`Audit claim ${crypto.randomUUID()}`);
    const email = `claim-${crypto.randomUUID()}@example.com`;
    await grantCompanyAccess(db, { companyId: company.id, email });
    const user = await createUser(email);
    await claimPendingCompanyAccess(db, { userId: user.id, authenticatedEmail: email });
    await claimPendingCompanyAccess(db, { userId: user.id, authenticatedEmail: email });
    const events = await listCompanyAccessHistory(db, { companyId: company.id, email });
    expect(events.map((row) => row.eventType).sort()).toEqual([
      "invite_claimed",
      "invite_created",
      "membership_granted",
    ]);
    expect(events.filter((row) => row.eventType === "invite_claimed")[0])
      .toMatchObject({ actor: "system", source: "oauth_invite_claim" });
  });

  it.skipIf(!HAS_DB)("retains revoke history and reconstructs repeated access periods", async () => {
    if (!db) return;
    const company = await createCompany(`Audit cycles ${crypto.randomUUID()}`);
    const user = await createUser(`cycles-${crypto.randomUUID()}@example.com`);
    await grantCompanyMembership(db, user.id, company.id, user.email);
    await revokeCompanyMembership(db, user.id, company.id, user.email);
    await revokeCompanyMembership(db, user.id, company.id, user.email);
    await grantCompanyMembership(db, user.id, company.id, user.email);
    const events = await listCompanyAccessHistory(db, { companyId: company.id, email: user.email });
    expect(events.map((row) => row.eventType)).toEqual([
      "membership_granted",
      "membership_revoked",
      "membership_granted",
    ]);
    expect(reconstructAccessPeriods(events)).toHaveLength(2);
    expect(events.some((row) => row.currentAccess)).toBe(true);
  });

  it.skipIf(!HAS_DB)("separates users and companies and never authorizes from audit or invite rows", async () => {
    if (!db) return;
    const companyA = await createCompany(`Audit company A ${crypto.randomUUID()}`);
    const companyB = await createCompany(`Audit company B ${crypto.randomUUID()}`);
    const userA = await createUser(`multi-a-${crypto.randomUUID()}@example.com`);
    const userB = await createUser(`multi-b-${crypto.randomUUID()}@example.com`);
    await grantCompanyMembership(db, userA.id, companyA.id, userA.email);
    await grantCompanyMembership(db, userB.id, companyA.id, userB.email);
    await grantCompanyMembership(db, userA.id, companyB.id, userA.email);

    const companyAHistory = await listCompanyAccessHistory(db, { companyId: companyA.id });
    const userAHistory = await listCompanyAccessHistory(db, { email: userA.email });
    expect(new Set(companyAHistory.map((row) => row.normalizedEmail))).toEqual(
      new Set([userA.email, userB.email]),
    );
    expect(new Set(userAHistory.map((row) => row.companyId))).toEqual(
      new Set([companyA.id, companyB.id]),
    );

    await db.delete(schema.companyMembers)
      .where(eq(schema.companyMembers.userId, userA.id));
    await db.insert(schema.companyAccessInvites).values({
      companyId: companyB.id,
      normalizedEmail: userA.email,
    }).onConflictDoNothing();
    const memberships = await db.select().from(schema.companyMembers)
      .where(eq(schema.companyMembers.userId, userA.id));
    expect(memberships).toEqual([]);
  });
});
