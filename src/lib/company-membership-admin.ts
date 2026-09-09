import { and, eq } from "drizzle-orm";
import type { Db } from "@/src/db";
import { companyAccessEvents, companyMembers } from "@/src/db/schema";
import { normalizeEmail } from "@/src/lib/email-normalization";

export async function grantCompanyMembership(
  db: Db,
  userId: string,
  companyId: number,
  email: string,
) {
  const normalizedEmail = normalizeEmail(email);
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(companyMembers)
      .values({ userId, companyId })
      .onConflictDoNothing({ target: [companyMembers.userId, companyMembers.companyId] })
      .returning({ userId: companyMembers.userId });
    if (inserted.length === 1) {
      await tx.insert(companyAccessEvents).values({
        companyId,
        userId,
        normalizedEmail,
        eventType: "membership_granted",
        actor: "admin",
        source: "operator_cli",
      });
    }
    return { granted: inserted.length === 1 };
  });
}

export async function revokeCompanyMembership(
  db: Db,
  userId: string,
  companyId: number,
  email: string,
) {
  const normalizedEmail = normalizeEmail(email);
  return db.transaction(async (tx) => {
    const deleted = await tx
      .delete(companyMembers)
      .where(and(eq(companyMembers.userId, userId), eq(companyMembers.companyId, companyId)))
      .returning({ userId: companyMembers.userId });
    if (deleted.length === 1) {
      await tx.insert(companyAccessEvents).values({
        companyId,
        userId,
        normalizedEmail,
        eventType: "membership_revoked",
        actor: "admin",
        source: "operator_cli",
      });
    }
    return { revoked: deleted.length === 1 };
  });
}
