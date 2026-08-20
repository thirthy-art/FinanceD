import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/db", () => ({ getDb: vi.fn() }));

import { getDb } from "@/src/db";
import { GET, POST as createCompany } from "@/app/api/companies/route";
import { POST as selectCompany } from "@/app/api/companies/active/route";

const mockGetDb = vi.mocked(getDb);

function request(url: string, body?: unknown) {
  return new Request(url, body === undefined ? undefined : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("company management API", () => {
  it("lists companies in deterministic order with the active company id", async () => {
    const rows = [
      { id: 1, name: "Company A", baseCurrency: "EUR" },
      { id: 2, name: "Company B", baseCurrency: "GBP" },
    ];
    const orderBy = vi.fn().mockResolvedValue(rows);
    mockGetDb.mockReturnValue({
      select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ orderBy }) }),
    } as never);

    const response = await GET(new Request("http://localhost/api/companies", {
      headers: { Cookie: "financed_company_id=2" },
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ companies: rows, activeCompanyId: 2 });
    expect(orderBy).toHaveBeenCalledOnce();
  });

  it("lists all companies with a null active id when selection is required", async () => {
    const rows = [
      { id: 1, name: "Company A", baseCurrency: "EUR" },
      { id: 2, name: "Company B", baseCurrency: "GBP" },
    ];
    mockGetDb.mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({ orderBy: vi.fn().mockResolvedValue(rows) }),
      }),
    } as never);

    const response = await GET(request("http://localhost/api/companies"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ companies: rows, activeCompanyId: null });
  });

  it("creates a normalized company and makes it active", async () => {
    const created = { id: 3, name: "Real Company", baseCurrency: "USD" };
    const returning = vi.fn().mockResolvedValue([created]);
    const values = vi.fn().mockReturnValue({ returning });
    mockGetDb.mockReturnValue({ insert: vi.fn().mockReturnValue({ values }) } as never);

    const response = await createCompany(request("http://localhost/api/companies", {
      name: "  Real Company  ",
      baseCurrency: "usd",
    }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(created);
    expect(values).toHaveBeenCalledWith({ name: "Real Company", baseCurrency: "USD" });
    expect(response.headers.get("set-cookie")).toContain("financed_company_id=3");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=lax");
  });

  it("rejects invalid company creation input before database access", async () => {
    const response = await createCompany(request("http://localhost/api/companies", {
      name: " ",
      baseCurrency: "EURO",
    }));
    expect(response.status).toBe(400);
    expect(mockGetDb).not.toHaveBeenCalled();
  });

  it("switches to an existing company and sets the cookie", async () => {
    const company = { id: 7, name: "Company B", baseCurrency: "GBP" };
    const limit = vi.fn().mockResolvedValue([company]);
    mockGetDb.mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit }) }),
      }),
    } as never);

    const response = await selectCompany(request("http://localhost/api/companies/active", { companyId: 7 }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(company);
    expect(response.headers.get("set-cookie")).toContain("financed_company_id=7");
  });

  it("returns 404 without setting a cookie for a nonexistent company", async () => {
    const limit = vi.fn().mockResolvedValue([]);
    mockGetDb.mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit }) }),
      }),
    } as never);

    const response = await selectCompany(request("http://localhost/api/companies/active", { companyId: 999 }));
    expect(response.status).toBe(404);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
