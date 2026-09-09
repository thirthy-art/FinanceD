import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  grantCompanyMembership,
  revokeCompanyMembership,
} from "@/src/lib/company-membership-admin";

describe("private-beta membership administration", () => {
  it("grant is idempotent", async () => {
    const returning = vi.fn()
      .mockResolvedValueOnce([{ userId: "user-a" }])
      .mockResolvedValueOnce([]);
    const db = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoNothing: vi.fn().mockReturnValue({ returning }),
        }),
      }),
    };
    await expect(grantCompanyMembership(db as never, "user-a", 1)).resolves.toEqual({ granted: true });
    await expect(grantCompanyMembership(db as never, "user-a", 1)).resolves.toEqual({ granted: false });
  });

  it("revoke deletes only the selected membership and reports missing access", async () => {
    const returning = vi.fn()
      .mockResolvedValueOnce([{ userId: "user-a" }])
      .mockResolvedValueOnce([]);
    const db = {
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ returning }),
      }),
    };
    await expect(revokeCompanyMembership(db as never, "user-a", 1)).resolves.toEqual({ revoked: true });
    await expect(revokeCompanyMembership(db as never, "user-a", 1)).resolves.toEqual({ revoked: false });
  });
});
