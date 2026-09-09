import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/src/db";
import {
  authUsers,
  companies,
  companyAccessEvents,
  companyAccessInvites,
  companyMembers,
} from "@/src/db/schema";
import { normalizeEmail } from "@/src/lib/email-normalization";

const companyNameSchema = z.string().trim().min(1).max(255);

export type AccessProvisioningStatus =
  | "membership-created"
  | "membership-already-existed"
  | "pending-first-login-claim";

export interface AccessProvisioningResult {
  companyId: number;
  companyName: string;
  normalizedEmail: string;
  status: AccessProvisioningStatus;
}

type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

async function findAuthUserByEmail(tx: Transaction, normalizedEmail: string) {
  const users = await tx
    .select({ id: authUsers.id, email: authUsers.email })
    .from(authUsers)
    .where(sql`lower(btrim(${authUsers.email})) = ${normalizedEmail}`)
    .limit(2);
  if (users.length > 1) {
    throw new Error(`Multiple Auth.js users have the normalized email ${normalizedEmail}.`);
  }
  return users[0] ?? null;
}

async function grantOrInvite(
  tx: Transaction,
  company: { id: number; name: string },
  normalizedEmail: string,
): Promise<AccessProvisioningResult> {
  const user = await findAuthUserByEmail(tx, normalizedEmail);
  if (!user) {
    const [invite] = await tx
      .insert(companyAccessInvites)
      .values({ companyId: company.id, normalizedEmail })
      .onConflictDoNothing({
        target: [companyAccessInvites.companyId, companyAccessInvites.normalizedEmail],
      })
      .returning({ id: companyAccessInvites.id });
    if (invite) {
      await tx.insert(companyAccessEvents).values({
        companyId: company.id,
        normalizedEmail,
        eventType: "invite_created",
        actor: "admin",
        source: "operator_cli",
        inviteId: invite.id,
      });
    }
    return {
      companyId: company.id,
      companyName: company.name,
      normalizedEmail,
      status: "pending-first-login-claim",
    };
  }

  const inserted = await tx
    .insert(companyMembers)
    .values({ userId: user.id, companyId: company.id })
    .onConflictDoNothing({ target: [companyMembers.userId, companyMembers.companyId] })
    .returning({ userId: companyMembers.userId });

  if (inserted.length === 1) {
    await tx.insert(companyAccessEvents).values({
      companyId: company.id,
      userId: user.id,
      normalizedEmail,
      eventType: "membership_granted",
      actor: "admin",
      source: "operator_cli",
    });
  }

  const claimedInvites = await tx
    .update(companyAccessInvites)
    .set({ claimedAt: new Date(), claimedByUserId: user.id })
    .where(and(
      eq(companyAccessInvites.companyId, company.id),
      eq(companyAccessInvites.normalizedEmail, normalizedEmail),
      isNull(companyAccessInvites.claimedAt),
    ))
    .returning({ id: companyAccessInvites.id });

  if (claimedInvites.length > 0) {
    await tx.insert(companyAccessEvents).values(claimedInvites.map((invite) => ({
      companyId: company.id,
      userId: user.id,
      normalizedEmail,
      eventType: "invite_claimed" as const,
      actor: "admin" as const,
      source: "operator_cli" as const,
      inviteId: invite.id,
    })));
  }

  return {
    companyId: company.id,
    companyName: company.name,
    normalizedEmail,
    status: inserted.length === 1 ? "membership-created" : "membership-already-existed",
  };
}

export async function provisionCompanyWithFirstUser(
  db: Db,
  input: { companyName: string; email: string },
): Promise<AccessProvisioningResult> {
  const companyName = companyNameSchema.parse(input.companyName);
  const normalizedEmail = normalizeEmail(input.email);
  const companyNameKey = companyName.toLowerCase();

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${companyNameKey}))`);
    const existing = await tx
      .select({ id: companies.id, name: companies.name })
      .from(companies)
      .where(sql`lower(btrim(${companies.name})) = ${companyNameKey}`)
      .limit(1);
    if (existing.length > 0) {
      throw new Error(
        `Company ${existing[0].name} (${existing[0].id}) already exists; use auth:grant with its company ID.`,
      );
    }

    const [company] = await tx
      .insert(companies)
      .values({ name: companyName })
      .returning({ id: companies.id, name: companies.name });
    if (!company) throw new Error("Company creation did not return a company.");
    return grantOrInvite(tx, company, normalizedEmail);
  });
}

export async function grantCompanyAccess(
  db: Db,
  input: { companyId: number; email: string },
): Promise<AccessProvisioningResult> {
  if (!Number.isSafeInteger(input.companyId) || input.companyId <= 0) {
    throw new Error("Company ID must be a positive integer.");
  }
  const normalizedEmail = normalizeEmail(input.email);

  return db.transaction(async (tx) => {
    const [company] = await tx
      .select({ id: companies.id, name: companies.name })
      .from(companies)
      .where(eq(companies.id, input.companyId))
      .limit(1);
    if (!company) throw new Error(`Company ${input.companyId} does not exist.`);
    return grantOrInvite(tx, company, normalizedEmail);
  });
}

export async function claimPendingCompanyAccess(
  db: Db,
  input: { userId: string; authenticatedEmail: string },
): Promise<{ claimedCompanyIds: number[] }> {
  const normalizedEmail = normalizeEmail(input.authenticatedEmail);

  return db.transaction(async (tx) => {
    const [user] = await tx
      .select({ id: authUsers.id, email: authUsers.email })
      .from(authUsers)
      .where(eq(authUsers.id, input.userId))
      .limit(1);
    if (!user?.email || normalizeEmail(user.email) !== normalizedEmail) {
      throw new Error("Authenticated identity does not match the persisted Auth.js user email.");
    }

    const pending = await tx
      .select({ id: companyAccessInvites.id, companyId: companyAccessInvites.companyId })
      .from(companyAccessInvites)
      .where(and(
        eq(companyAccessInvites.normalizedEmail, normalizedEmail),
        isNull(companyAccessInvites.claimedAt),
      ))
      .for("update");
    if (pending.length === 0) return { claimedCompanyIds: [] };

    const insertedMemberships = await tx
      .insert(companyMembers)
      .values(pending.map((invite) => ({ userId: user.id, companyId: invite.companyId })))
      .onConflictDoNothing({ target: [companyMembers.userId, companyMembers.companyId] })
      .returning({ companyId: companyMembers.companyId });

    const claimedInvites = await tx
      .update(companyAccessInvites)
      .set({ claimedAt: new Date(), claimedByUserId: user.id })
      .where(and(
        inArray(companyAccessInvites.id, pending.map((invite) => invite.id)),
        isNull(companyAccessInvites.claimedAt),
      ))
      .returning({ id: companyAccessInvites.id, companyId: companyAccessInvites.companyId });

    const insertedCompanyIds = new Set(insertedMemberships.map((membership) => membership.companyId));
    const inviteByCompanyId = new Map(pending.map((invite) => [invite.companyId, invite.id]));
    const events = [
      ...claimedInvites.map((invite) => ({
        companyId: invite.companyId,
        userId: user.id,
        normalizedEmail,
        eventType: "invite_claimed" as const,
        actor: "system" as const,
        source: "oauth_invite_claim" as const,
        inviteId: invite.id,
      })),
      ...Array.from(insertedCompanyIds, (companyId) => ({
        companyId,
        userId: user.id,
        normalizedEmail,
        eventType: "membership_granted" as const,
        actor: "system" as const,
        source: "oauth_invite_claim" as const,
        inviteId: inviteByCompanyId.get(companyId),
      })),
    ];
    if (events.length > 0) await tx.insert(companyAccessEvents).values(events);

    return { claimedCompanyIds: claimedInvites.map((invite) => invite.companyId) };
  });
}
