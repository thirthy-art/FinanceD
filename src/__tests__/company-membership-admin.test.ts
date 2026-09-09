import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  grantCompanyMembership,
  revokeCompanyMembership,
} from "@/src/lib/company-membership-admin";

function fakeDb(returningRows: unknown[][]) {
  const values: unknown[] = [];
  const returning = [...returningRows];
  const tx = {
    insert: vi.fn().mockImplementation(() => ({
      values: vi.fn().mockImplementation((inserted: unknown) => {
        values.push(inserted);
        return {
          onConflictDoNothing: vi.fn().mockReturnValue({
            returning: vi.fn().mockImplementation(async () => returning.shift() ?? []),
          }),
        };
      }),
    })),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockImplementation(async () => returning.shift() ?? []),
      }),
    }),
  };
  return {
    db: { transaction: vi.fn().mockImplementation((callback) => callback(tx)) } as never,
    values,
  };
}

describe("private-beta membership administration", () => {
  it("grant and audit event are transactionally idempotent", async () => {
    const first = fakeDb([[{ userId: "user-a" }]]);
    const repeat = fakeDb([[]]);
    await expect(grantCompanyMembership(first.db, "user-a", 1, " User@Example.com "))
      .resolves.toEqual({ granted: true });
    await expect(grantCompanyMembership(repeat.db, "user-a", 1, "user@example.com"))
      .resolves.toEqual({ granted: false });
    expect(first.values[1]).toEqual(expect.objectContaining({
      normalizedEmail: "user@example.com",
      eventType: "membership_granted",
      actor: "admin",
      source: "operator_cli",
    }));
    expect(repeat.values).toHaveLength(1);
  });

  it("revoke records one durable event only when a membership is deleted", async () => {
    const first = fakeDb([[{ userId: "user-a" }]]);
    const repeat = fakeDb([[]]);
    await expect(revokeCompanyMembership(first.db, "user-a", 1, " User@Example.com "))
      .resolves.toEqual({ revoked: true });
    await expect(revokeCompanyMembership(repeat.db, "user-a", 1, "user@example.com"))
      .resolves.toEqual({ revoked: false });
    expect(first.values).toEqual([expect.objectContaining({
      normalizedEmail: "user@example.com",
      eventType: "membership_revoked",
      actor: "admin",
      source: "operator_cli",
    })]);
    expect(repeat.values).toHaveLength(0);
  });
});
