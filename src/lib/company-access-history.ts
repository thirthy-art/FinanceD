import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "@/src/db";
import {
  companies,
  companyAccessEvents,
  companyMembers,
  type CompanyAccessActor,
  type CompanyAccessEventType,
  type CompanyAccessSource,
} from "@/src/db/schema";
import { normalizeEmail } from "@/src/lib/email-normalization";

export interface CompanyAccessHistoryFilter {
  companyId?: number;
  email?: string;
}

export interface CompanyAccessHistoryEvent {
  id: number;
  companyId: number;
  companyName: string;
  userId: string | null;
  normalizedEmail: string;
  eventType: CompanyAccessEventType;
  occurredAt: Date;
  actor: CompanyAccessActor;
  source: CompanyAccessSource;
  inviteId: number | null;
  currentAccess: boolean;
}

export interface AccessPeriod {
  start: Date;
  end: Date | null;
  startEventType: "membership_granted" | "membership_existing_at_audit_start";
}

export function reconstructAccessPeriods(
  events: Pick<CompanyAccessHistoryEvent, "id" | "eventType" | "occurredAt">[],
): AccessPeriod[] {
  const ordered = [...events].sort((left, right) => (
    left.occurredAt.getTime() - right.occurredAt.getTime() || left.id - right.id
  ));
  const periods: AccessPeriod[] = [];
  let open: AccessPeriod | null = null;

  for (const event of ordered) {
    if (
      event.eventType === "membership_granted"
      || event.eventType === "membership_existing_at_audit_start"
    ) {
      if (!open) {
        open = { start: event.occurredAt, end: null, startEventType: event.eventType };
      }
    } else if (event.eventType === "membership_revoked" && open) {
      open.end = event.occurredAt;
      periods.push(open);
      open = null;
    }
  }

  if (open) periods.push(open);
  return periods;
}

export async function listCompanyAccessHistory(
  db: Db,
  filter: CompanyAccessHistoryFilter,
): Promise<CompanyAccessHistoryEvent[]> {
  if (filter.companyId === undefined && filter.email === undefined) {
    throw new Error("At least one company access history filter is required.");
  }
  if (
    filter.companyId !== undefined
    && (!Number.isSafeInteger(filter.companyId) || filter.companyId <= 0)
  ) {
    throw new Error("Company ID must be a positive integer.");
  }
  const normalizedEmail = filter.email === undefined ? undefined : normalizeEmail(filter.email);
  const conditions = [];
  if (filter.companyId !== undefined) {
    conditions.push(eq(companyAccessEvents.companyId, filter.companyId));
  }
  if (normalizedEmail !== undefined) {
    conditions.push(eq(companyAccessEvents.normalizedEmail, normalizedEmail));
  }

  return db
    .select({
      id: companyAccessEvents.id,
      companyId: companyAccessEvents.companyId,
      companyName: companies.name,
      userId: companyAccessEvents.userId,
      normalizedEmail: companyAccessEvents.normalizedEmail,
      eventType: companyAccessEvents.eventType,
      occurredAt: companyAccessEvents.occurredAt,
      actor: companyAccessEvents.actor,
      source: companyAccessEvents.source,
      inviteId: companyAccessEvents.inviteId,
      currentAccess: sql<boolean>`exists (
        select 1 from ${companyMembers}
        where ${companyMembers.companyId} = ${companyAccessEvents.companyId}
          and ${companyMembers.userId} = ${companyAccessEvents.userId}
      )`,
    })
    .from(companyAccessEvents)
    .innerJoin(companies, eq(companyAccessEvents.companyId, companies.id))
    .where(and(...conditions))
    .orderBy(
      asc(companyAccessEvents.companyId),
      asc(companyAccessEvents.normalizedEmail),
      asc(companyAccessEvents.occurredAt),
      asc(companyAccessEvents.id),
    );
}
