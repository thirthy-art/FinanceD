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

  it("requires selection without creating a company when none exist", async () => {
    const insert = vi.fn();
    const transaction = vi.fn();
    const db = {
      select: vi.fn().mockReturnValue(selectResult([])),
      insert,
      transaction,
    };
    mockGetDb.mockReturnValue(db as never);

    await expect(resolveActiveCompany()).rejects.toBeInstanceOf(ActiveCompanySelectionRequiredError);
    expect(insert).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
});
