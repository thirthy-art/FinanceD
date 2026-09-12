import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/src/lib/active-company", () => ({ getActiveCompanyFromRequest: vi.fn() }));
vi.mock("@/src/lib/payment-ledger", () => ({ createAccountAsset: vi.fn(), updateAccountAsset: vi.fn() }));

import { PATCH, POST } from "@/app/api/payment-accounts/assets/route";
import { getActiveCompanyFromRequest } from "@/src/lib/active-company";
import { createAccountAsset, updateAccountAsset } from "@/src/lib/payment-ledger";

const activeCompany = vi.mocked(getActiveCompanyFromRequest); const createAsset = vi.mocked(createAccountAsset); const updateAsset = vi.mocked(updateAccountAsset);
const request = (method: string, body: unknown) => new NextRequest("http://localhost/api/payment-accounts/assets", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const valid = { paymentAccountId: 12, assetCode: "EUR", assetType: "fiat", openingAvailableBalance: "1000", openingReserveBalance: "50", openingBalanceDate: "2026-09-01" };

beforeEach(() => { vi.clearAllMocks(); activeCompany.mockResolvedValue({ id: 7 } as never); });

describe("payment-account opening balance API", () => {
  it("rejects a missing opening balance date before business persistence", async () => {
    const response = await POST(request("POST", { ...valid, openingBalanceDate: "" }));
    expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: "Opening balance date is required." }); expect(createAsset).not.toHaveBeenCalled();
  });

  it("cannot silently overwrite through the normal create flow", async () => {
    createAsset.mockRejectedValue(new Error("An opening balance already exists for this account and asset. Enter edit mode to replace it."));
    const response = await POST(request("POST", valid));
    expect(response.status).toBe(400); expect((await response.json()).error).toMatch(/already exists/); expect(updateAsset).not.toHaveBeenCalled();
  });

  it("requires confirmation and permits an explicit update", async () => {
    expect((await PATCH(request("PATCH", valid))).status).toBe(400); expect(updateAsset).not.toHaveBeenCalled();
    updateAsset.mockResolvedValue({ id: 9 } as never);
    const response = await PATCH(request("PATCH", { ...valid, confirmOverwrite: true }));
    expect(response.status).toBe(200); expect(updateAsset).toHaveBeenCalledWith(7, valid);
  });
});
