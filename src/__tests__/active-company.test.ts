import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/db", () => ({ getDb: vi.fn() }));

import { getDb } from "@/src/db";
import {
  ACTIVE_COMPANY_COOKIE,
  ActiveCompanySelectionRequiredError,
  getActiveCompanyFromRequest,
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

  it("uses the selected company when a valid cookie exists in a multi-company deployment", async () => {
    const selected = { id: 8, name: "Company B", baseCurrency: "GBP" };
    const query = selectResult([selected]);
    const db = { select: vi.fn().mockReturnValue(query) };
    mockGetDb.mockReturnValue(db as never);

    await expect(resolveActiveCompany("8")).resolves.toEqual(selected);
    expect(query.chain.where).toHaveBeenCalledOnce();
    expect(query.chain.orderBy).not.toHaveBeenCalled();
  });

  it("uses the sole company when the cookie is missing", async () => {
    const sole = { id: 2, name: "Company A", baseCurrency: "EUR" };
    const ordered = selectResult([sole]);
    const db = { select: vi.fn().mockReturnValue(ordered) };
    mockGetDb.mockReturnValue(db as never);

    await expect(resolveActiveCompany()).resolves.toEqual(sole);
    expect(ordered.chain.orderBy).toHaveBeenCalledOnce();
  });

  it.each([
    ["missing", undefined],
    ["malformed", "not-an-id"],
  ])("requires selection with multiple companies and a %s cookie", async (_label, cookie) => {
    const companies = [
      { id: 2, name: "Company A", baseCurrency: "EUR" },
      { id: 8, name: "Company B", baseCurrency: "GBP" },
    ];
    const db = { select: vi.fn().mockReturnValue(selectResult(companies)) };
    mockGetDb.mockReturnValue(db as never);

    await expect(resolveActiveCompany(cookie)).rejects.toBeInstanceOf(ActiveCompanySelectionRequiredError);
  });

  it("requires selection when a stale cookie does not match either company", async () => {
    const stale = selectResult([]);
    const ordered = selectResult([
      { id: 2, name: "Company A", baseCurrency: "EUR" },
      { id: 8, name: "Company B", baseCurrency: "GBP" },
    ]);
    const db = { select: vi.fn().mockReturnValueOnce(stale).mockReturnValueOnce(ordered) };
    mockGetDb.mockReturnValue(db as never);

    await expect(resolveActiveCompany("999")).rejects.toMatchObject({
      message: "Active company selection required.",
      code: "ACTIVE_COMPANY_REQUIRED",
    });
  });

  it("returns the centralized 409 API response when selection is required", async () => {
    const db = { select: vi.fn().mockReturnValue(selectResult([
      { id: 2, name: "Company A", baseCurrency: "EUR" },
      { id: 8, name: "Company B", baseCurrency: "GBP" },
    ])) };
    mockGetDb.mockReturnValue(db as never);

    const response = await getActiveCompanyFromRequest(new Request("http://localhost/api/invoices"));
    expect(response).toBeInstanceOf(Response);
    if (!(response instanceof Response)) throw new Error("Expected a response.");
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Active company selection required.",
      code: "ACTIVE_COMPANY_REQUIRED",
    });
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
