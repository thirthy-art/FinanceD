import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/src/db", () => ({ getDb: vi.fn() }));

import { getDb } from "@/src/db";
import { readAiSettings } from "@/src/lib/ai-settings";

const mockGetDb = vi.mocked(getDb);

function rejectingDb(error: unknown) {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockRejectedValue(error) }),
      }),
    }),
  } as never;
}

beforeEach(() => vi.clearAllMocks());

describe("AI settings migration bootstrap", () => {
  it("recognizes a missing-table PostgreSQL code wrapped by Drizzle", async () => {
    const pgError = Object.assign(new Error("relation does not exist"), { code: "42P01" });
    const drizzleError = Object.assign(new Error("Failed query", { cause: pgError }), { code: "DRIZZLE_QUERY_ERROR" });
    mockGetDb.mockReturnValue(rejectingDb(drizzleError));
    await expect(readAiSettings()).resolves.toBeNull();
  });

  it("does not swallow unrelated database failures in a cause chain", async () => {
    const pgError = Object.assign(new Error("connection failed"), { code: "08006" });
    const drizzleError = new Error("Failed query", { cause: pgError });
    mockGetDb.mockReturnValue(rejectingDb(drizzleError));
    await expect(readAiSettings()).rejects.toBe(drizzleError);
  });
});
