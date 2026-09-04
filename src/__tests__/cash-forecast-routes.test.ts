import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/db", () => ({ getDb: vi.fn() }));
vi.mock("@/src/lib/active-company", () => ({ getActiveCompanyFromRequest: vi.fn() }));

import { getDb } from "@/src/db";
import { getActiveCompanyFromRequest } from "@/src/lib/active-company";
import { POST } from "@/app/api/cash-flow/forecast/items/route";
import { PUT, DELETE } from "@/app/api/cash-flow/forecast/items/[id]/route";
import { PUT as putSettings } from "@/app/api/cash-flow/forecast/settings/route";

const activeCompany = vi.mocked(getActiveCompanyFromRequest);
const mockGetDb = vi.mocked(getDb);
const validItem = { date: "2026-09-10", description: "Payroll", direction: "outflow", category: "payroll", amount: "123.4500" };
const request = (method: string, body?: unknown) => new Request("http://localhost/api/cash-flow/forecast", {
  method, headers: body ? { "Content-Type": "application/json" } : undefined,
  body: body ? JSON.stringify(body) : undefined,
});

beforeEach(() => {
  vi.clearAllMocks();
  activeCompany.mockResolvedValue({ id: 7 } as never);
});

describe("cash forecast routes", () => {
  it("creates a manual item with the active company, ignoring browser companyId", async () => {
    const returning = vi.fn().mockResolvedValue([{ id: 1, companyId: 7, ...validItem }]);
    const values = vi.fn().mockImplementation((row) => ({ returning: () => returning(row) }));
    mockGetDb.mockReturnValue({ insert: vi.fn().mockReturnValue({ values }) } as never);
    const response = await POST(request("POST", { ...validItem, companyId: 999 }));
    expect(response.status).toBe(201);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ companyId: 7 }));
  });

  it.each([
    [{ ...validItem, direction: "sideways" }],
    [{ ...validItem, category: "not-a-category" }],
    [{ ...validItem, date: "2026-02-30" }],
    [{ ...validItem, amount: "-1.00" }],
    [{ ...validItem, amount: "1.00001" }],
    [{ ...validItem, direction: "inflow", category: "payroll" }],
  ])("rejects invalid manual item input", async (body) => {
    const response = await POST(request("POST", body));
    expect(response.status).toBe(400);
    expect(activeCompany).not.toHaveBeenCalled();
  });

  it("supports company-scoped edit and delete", async () => {
    const updateReturning = vi.fn().mockResolvedValue([{ id: 3, companyId: 7, ...validItem }]);
    const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
    const deleteReturning = vi.fn().mockResolvedValue([{ id: 3 }]);
    const deleteWhere = vi.fn().mockReturnValue({ returning: deleteReturning });
    mockGetDb.mockReturnValue({
      update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: updateWhere }) }),
      delete: vi.fn().mockReturnValue({ where: deleteWhere }),
    } as never);
    expect((await PUT(request("PUT", validItem), { params: Promise.resolve({ id: "3" }) })).status).toBe(200);
    expect((await DELETE(request("DELETE"), { params: Promise.resolve({ id: "3" }) })).status).toBe(200);
    expect(updateWhere).toHaveBeenCalledOnce();
    expect(deleteWhere).toHaveBeenCalledOnce();
  });

  it("returns 404 when a cross-company item is not matched by a scoped write", async () => {
    mockGetDb.mockReturnValue({ delete: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }) }) } as never);
    const response = await DELETE(request("DELETE"), { params: Promise.resolve({ id: "88" }) });
    expect(response.status).toBe(404);
  });

  it("validates settings and permits negative opening cash but not a negative buffer", async () => {
    const returning = vi.fn().mockResolvedValue([{ companyId: 7, openingCashBalance: "-5.0000", minimumCashBuffer: "0.0000" }]);
    const onConflictDoUpdate = vi.fn().mockReturnValue({ returning });
    mockGetDb.mockReturnValue({ insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ onConflictDoUpdate }) }) } as never);
    expect((await putSettings(request("PUT", { openingCashBalance: "-5.0000", minimumCashBuffer: "0.0000" }))).status).toBe(200);
    expect((await putSettings(request("PUT", { openingCashBalance: "0", minimumCashBuffer: "-1" }))).status).toBe(400);
  });

  it("rejects non-positive item IDs", async () => {
    expect((await DELETE(request("DELETE"), { params: Promise.resolve({ id: "0" }) })).status).toBe(400);
    expect(activeCompany).not.toHaveBeenCalled();
  });
});
