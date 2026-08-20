import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/db", () => ({ getDb: vi.fn() }));

import { getDb } from "@/src/db";
import {
  ACTIVE_COMPANY_COOKIE,
  parseActiveCompanyId,
  resolveActiveCompany,
} from "@/src/lib/active-company";

const mockGetDb = vi.mocked(getDb);

function selectResult(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const chain = {
    where: vi.fn().mockReturnValue({ limit }),
    orderBy: vi.fn().mockReturnValue({ limit }),
  };
  return { from: vi.fn().mockReturnValue(chain), chain };
}

beforeEach(() => vi.clearAllMocks());

describe("active company resolution", () => {
  it("parses only positive safe integer cookie values", () => {
    expect(ACTIVE_COMPANY_COOKIE).toBe("financed_company_id");
    expect(parseActiveCompanyId("42")).toBe(42);
    expect(parseActiveCompanyId("0")).toBeNull();
    expect(parseActiveCompanyId("1x")).toBeNull();
    expect(parseActiveCompanyId("9007199254740992")).toBeNull();
  });

  it("uses an existing company referenced by a valid cookie", async () => {
    const selected = { id: 8, name: "Company B", baseCurrency: "GBP" };
    const query = selectResult([selected]);
    const db = { select: vi.fn().mockReturnValue(query) };
    mockGetDb.mockReturnValue(db as never);

    await expect(resolveActiveCompany("8")).resolves.toEqual(selected);
    expect(query.chain.where).toHaveBeenCalledOnce();
    expect(query.chain.orderBy).not.toHaveBeenCalled();
  });

  it("uses the lowest-id deterministic fallback for a missing or stale cookie", async () => {
    const fallback = { id: 2, name: "Company A", baseCurrency: "EUR" };
    const stale = selectResult([]);
    const ordered = selectResult([fallback]);
    const db = { select: vi.fn().mockReturnValueOnce(stale).mockReturnValueOnce(ordered) };
    mockGetDb.mockReturnValue(db as never);

    await expect(resolveActiveCompany("999")).resolves.toEqual(fallback);
    expect(ordered.chain.orderBy).toHaveBeenCalledOnce();
  });

  it("creates the initial company under a PostgreSQL transaction advisory lock", async () => {
    const initial = { id: 1, name: "My Company", baseCurrency: "USD" };
    const outside = selectResult([]);
    const inside = selectResult([]);
    const execute = vi.fn().mockResolvedValue(undefined);
    const returning = vi.fn().mockResolvedValue([initial]);
    const insert = vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({ returning }),
    });
    const tx = { select: vi.fn().mockReturnValue(inside), execute, insert };
    const db = {
      select: vi.fn().mockReturnValue(outside),
      transaction: vi.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
    };
    mockGetDb.mockReturnValue(db as never);

    await expect(resolveActiveCompany()).resolves.toEqual(initial);
    expect(execute).toHaveBeenCalledOnce();
    expect(inside.chain.orderBy).toHaveBeenCalledOnce();
    expect(insert).toHaveBeenCalledOnce();
  });

  it("rechecks after acquiring the bootstrap lock before inserting", async () => {
    const winner = { id: 1, name: "Concurrent winner", baseCurrency: "EUR" };
    const outside = selectResult([]);
    const inside = selectResult([winner]);
    const tx = { select: vi.fn().mockReturnValue(inside), execute: vi.fn(), insert: vi.fn() };
    const db = {
      select: vi.fn().mockReturnValue(outside),
      transaction: vi.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
    };
    mockGetDb.mockReturnValue(db as never);

    await expect(resolveActiveCompany()).resolves.toEqual(winner);
    expect(tx.execute).toHaveBeenCalledOnce();
    expect(tx.insert).not.toHaveBeenCalled();
  });
});
