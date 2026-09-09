import { and, eq } from "drizzle-orm";
import type { Db } from "@/src/db";
import { companyMembers } from "@/src/db/schema";

export async function grantCompanyMembership(db: Db, userId: string, companyId: number) {
  const inserted = await db
    .insert(companyMembers)
    .values({ userId, companyId })
    .onConflictDoNothing({ target: [companyMembers.userId, companyMembers.companyId] })
    .returning({ userId: companyMembers.userId });
  return { granted: inserted.length === 1 };
}

export async function revokeCompanyMembership(db: Db, userId: string, companyId: number) {
  const deleted = await db
    .delete(companyMembers)
    .where(and(eq(companyMembers.userId, userId), eq(companyMembers.companyId, companyId)))
    .returning({ userId: companyMembers.userId });
  return { revoked: deleted.length === 1 };
}
