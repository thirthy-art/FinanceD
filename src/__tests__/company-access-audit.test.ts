import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  reconstructAccessPeriods,
  type CompanyAccessHistoryEvent,
} from "@/src/lib/company-access-history";

function event(
  id: number,
  eventType: CompanyAccessHistoryEvent["eventType"],
  occurredAt: string,
): Pick<CompanyAccessHistoryEvent, "id" | "eventType" | "occurredAt"> {
  return { id, eventType, occurredAt: new Date(occurredAt) };
}

describe("company access audit history", () => {
  it("reconstructs grant, revoke, and re-grant as two distinct periods", () => {
    const periods = reconstructAccessPeriods([
      event(1, "membership_granted", "2026-09-01T10:15:00Z"),
      event(2, "membership_revoked", "2026-09-05T16:40:00Z"),
      event(3, "membership_granted", "2026-09-08T09:20:00Z"),
    ]);
    expect(periods).toEqual([
      {
        start: new Date("2026-09-01T10:15:00Z"),
        end: new Date("2026-09-05T16:40:00Z"),
        startEventType: "membership_granted",
      },
      {
        start: new Date("2026-09-08T09:20:00Z"),
        end: null,
        startEventType: "membership_granted",
      },
    ]);
  });

  it("treats bootstrap presence as an explicit audit-boundary period", () => {
    expect(reconstructAccessPeriods([
      event(1, "membership_existing_at_audit_start", "2026-09-09T10:00:00Z"),
    ])).toEqual([{
      start: new Date("2026-09-09T10:00:00Z"),
      end: null,
      startEventType: "membership_existing_at_audit_start",
    }]);
  });

  it("does not treat invite-only events as access periods", () => {
    expect(reconstructAccessPeriods([
      event(1, "invite_created", "2026-09-01T10:00:00Z"),
      event(2, "invite_claimed", "2026-09-02T10:00:00Z"),
    ])).toEqual([]);
  });

  it("uses ID as a deterministic tie-breaker for same-timestamp events", () => {
    const instant = "2026-09-01T10:00:00Z";
    const periods = reconstructAccessPeriods([
      event(2, "membership_revoked", instant),
      event(1, "membership_granted", instant),
    ]);
    expect(periods).toEqual([{
      start: new Date(instant),
      end: new Date(instant),
      startEventType: "membership_granted",
    }]);
  });

  it("keeps authorization code independent from events and invites", async () => {
    const activeCompany = await readFile(
      path.join(process.cwd(), "src/lib/active-company.ts"),
      "utf8",
    );
    expect(activeCompany).toContain(".from(companyMembers)");
    expect(activeCompany).not.toContain("companyAccessEvents");
    expect(activeCompany).not.toContain("companyAccessInvites");
  });

  it("defines a narrow additive migration and truthful bootstrap", async () => {
    const migration = await readFile(
      path.join(process.cwd(), "drizzle/0020_chilly_archangel.sql"),
      "utf8",
    );
    expect(migration).toContain('CREATE TABLE "company_access_events"');
    expect(migration).toContain("membership_existing_at_audit_start");
    expect(migration).toContain("'system'");
    expect(migration).toContain("'audit_bootstrap'");
    expect(migration).toContain('FROM "company_members" AS member');
    expect(migration).not.toMatch(/DROP TABLE|TRUNCATE|ALTER TABLE "company_members"/i);
  });

  it("preserves audit rows across user and invite deletion", async () => {
    const migration = await readFile(
      path.join(process.cwd(), "drizzle/0020_chilly_archangel.sql"),
      "utf8",
    );
    expect(migration).toContain('"user_id") REFERENCES "public"."auth_users"("id") ON DELETE set null');
    expect(migration).toContain('"invite_id") REFERENCES "public"."company_access_invites"("id") ON DELETE set null');
    expect(migration).not.toContain('company_access_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade');
  });

  it("constrains professional actor and mechanism values", async () => {
    const migration = await readFile(
      path.join(process.cwd(), "drizzle/0020_chilly_archangel.sql"),
      "utf8",
    );
    expect(migration).toContain("in ('admin', 'system')");
    expect(migration).toContain("in ('operator_cli', 'oauth_invite_claim', 'audit_bootstrap')");
  });
});
