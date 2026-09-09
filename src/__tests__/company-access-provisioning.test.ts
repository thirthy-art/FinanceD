import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  claimPendingCompanyAccess,
  grantCompanyAccess,
  provisionCompanyWithFirstUser,
} from "@/src/lib/company-access-provisioning";
import { normalizeEmail } from "@/src/lib/email-normalization";

interface FakeOptions {
  selects: unknown[][];
  returning?: unknown[][];
}

function fakeDb(options: FakeOptions) {
  const inserts: Array<{ values: unknown }> = [];
  const updates: Array<{ values: unknown }> = [];
  const selects = [...options.selects];
  const returning = [...(options.returning ?? [])];

  const tx = {
    execute: vi.fn().mockResolvedValue([]),
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => {
          const rows = selects.shift() ?? [];
          return {
            limit: vi.fn().mockResolvedValue(rows),
            for: vi.fn().mockResolvedValue(rows),
          };
        }),
      }),
    })),
    insert: vi.fn().mockImplementation(() => ({
      values: vi.fn().mockImplementation((values: unknown) => {
        inserts.push({ values });
        return {
          returning: vi.fn().mockImplementation(async () => returning.shift() ?? []),
          onConflictDoNothing: vi.fn().mockImplementation(() => {
            const result = returning.shift() ?? [];
            return {
              returning: vi.fn().mockResolvedValue(result),
              then: (resolve: (value: unknown[]) => void) => Promise.resolve(result).then(resolve),
            };
          }),
        };
      }),
    })),
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockImplementation((values: unknown) => {
        updates.push({ values });
        return { where: vi.fn().mockResolvedValue([]) };
      }),
    })),
  };
  const db = {
    transaction: vi.fn().mockImplementation((callback) => callback(tx)),
  };
  return { db: db as never, inserts, updates, tx };
}

describe("company access provisioning", () => {
  it("normalizes provisioning and claim emails identically", () => {
    expect(normalizeEmail("  Alice.Example@Acme.COM  ")).toBe("alice.example@acme.com");
    expect(() => normalizeEmail("not an email")).toThrow();
  });

  it("creates a new company and pending access for a brand-new email", async () => {
    const fake = fakeDb({ selects: [[], []], returning: [[{ id: 41, name: "New Client Ltd" }]] });
    await expect(provisionCompanyWithFirstUser(fake.db, {
      companyName: " New Client Ltd ", email: " Owner@NewClient.com ",
    })).resolves.toEqual({
      companyId: 41,
      companyName: "New Client Ltd",
      normalizedEmail: "owner@newclient.com",
      status: "pending-first-login-claim",
    });
    expect(fake.inserts).toHaveLength(2);
    expect(fake.inserts[1].values).toEqual({ companyId: 41, normalizedEmail: "owner@newclient.com" });
  });

  it("refuses an ambiguous repeat of new-company provisioning", async () => {
    const fake = fakeDb({ selects: [[{ id: 7, name: "Acme Ltd" }]] });
    await expect(provisionCompanyWithFirstUser(fake.db, {
      companyName: "acme ltd", email: "alice@acme.com",
    })).rejects.toThrow("already exists; use auth:grant with its company ID");
    expect(fake.inserts).toHaveLength(0);
  });

  it("adds a brand-new email to an existing company without creating a company", async () => {
    const fake = fakeDb({ selects: [[{ id: 3, name: "Gleb Test" }], []] });
    await expect(grantCompanyAccess(fake.db, {
      companyId: 3, email: "newperson@example.com",
    })).resolves.toMatchObject({ companyId: 3, status: "pending-first-login-claim" });
    expect(fake.inserts).toHaveLength(1);
    expect(fake.inserts[0].values).toEqual({ companyId: 3, normalizedEmail: "newperson@example.com" });
  });

  it("grants an existing Auth.js user immediate idempotent membership", async () => {
    const first = fakeDb({
      selects: [[{ id: 3, name: "Gleb Test" }], [{ id: "user-1", email: "user@example.com" }]],
      returning: [[{ userId: "user-1" }]],
    });
    const second = fakeDb({
      selects: [[{ id: 3, name: "Gleb Test" }], [{ id: "user-1", email: "user@example.com" }]],
      returning: [[]],
    });
    await expect(grantCompanyAccess(first.db, { companyId: 3, email: "USER@example.com" }))
      .resolves.toMatchObject({ status: "membership-created" });
    await expect(grantCompanyAccess(second.db, { companyId: 3, email: "user@example.com" }))
      .resolves.toMatchObject({ status: "membership-already-existed" });
    expect(first.inserts[0].values).toEqual({ userId: "user-1", companyId: 3 });
  });

  it("claims every explicitly invited company and preserves conflict-safe memberships", async () => {
    const fake = fakeDb({
      selects: [
        [{ id: "consultant", email: "Consultant@Example.com" }],
        [{ id: 11, companyId: 7 }, { id: 12, companyId: 12 }],
      ],
    });
    await expect(claimPendingCompanyAccess(fake.db, {
      userId: "consultant", authenticatedEmail: "consultant@example.com",
    })).resolves.toEqual({ claimedCompanyIds: [7, 12] });
    expect(fake.inserts).toHaveLength(1);
    expect(fake.inserts[0].values).toEqual([
      { userId: "consultant", companyId: 7 },
      { userId: "consultant", companyId: 12 },
    ]);
    expect(fake.updates).toHaveLength(1);
  });

  it("repeated login with no unclaimed records creates no membership", async () => {
    const fake = fakeDb({
      selects: [[{ id: "user-1", email: "user@example.com" }], []],
    });
    await expect(claimPendingCompanyAccess(fake.db, {
      userId: "user-1", authenticatedEmail: "user@example.com",
    })).resolves.toEqual({ claimedCompanyIds: [] });
    expect(fake.inserts).toHaveLength(0);
    expect(fake.updates).toHaveLength(0);
  });

  it("does not claim access for a different authenticated email", async () => {
    const fake = fakeDb({
      selects: [[{ id: "user-1", email: "alice@example.com" }]],
    });
    await expect(claimPendingCompanyAccess(fake.db, {
      userId: "user-1", authenticatedEmail: "mallory@example.com",
    })).rejects.toThrow("does not match");
    expect(fake.inserts).toHaveLength(0);
  });

  it("leaves an uninvited user with zero claimed companies", async () => {
    const fake = fakeDb({
      selects: [[{ id: "random", email: "random@example.com" }], []],
    });
    await expect(claimPendingCompanyAccess(fake.db, {
      userId: "random", authenticatedEmail: "random@example.com",
    })).resolves.toEqual({ claimedCompanyIds: [] });
  });

  it("supports multiple distinct users for the same existing company", async () => {
    for (const email of ["alice@acme.com", "bob@acme.com", "finance@acme.com"]) {
      const fake = fakeDb({ selects: [[{ id: 7, name: "Acme Ltd" }], []] });
      await expect(grantCompanyAccess(fake.db, { companyId: 7, email }))
        .resolves.toMatchObject({ companyId: 7, normalizedEmail: email });
      expect(fake.inserts[0].values).toEqual({ companyId: 7, normalizedEmail: email });
    }
  });

  it("preserves an existing membership while claiming another company", async () => {
    const fake = fakeDb({
      selects: [
        [{ id: "user-1", email: "user@example.com" }],
        [{ id: 22, companyId: 12 }],
      ],
    });
    await claimPendingCompanyAccess(fake.db, {
      userId: "user-1", authenticatedEmail: "user@example.com",
    });
    expect(fake.inserts[0].values).toEqual([{ userId: "user-1", companyId: 12 }]);
    expect(fake.tx).not.toHaveProperty("delete");
  });
});
