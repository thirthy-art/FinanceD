import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/src/lib/active-company", () => ({ getActiveCompanyFromRequest: vi.fn() }));
vi.mock("@/src/lib/payment-ledger", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/src/lib/payment-ledger")>();
  return { ...original, deletePaymentAccount: vi.fn(), updatePaymentEvent: vi.fn(), deletePaymentEvent: vi.fn() };
});

import { DELETE as deleteAccount } from "@/app/api/payment-accounts/[id]/route";
import { DELETE as deleteEvent, PATCH as patchEvent } from "@/app/api/payment-events/[id]/route";
import { getActiveCompanyFromRequest } from "@/src/lib/active-company";
import { deletePaymentAccount, deletePaymentEvent, PaymentLedgerDependencyError, updatePaymentEvent } from "@/src/lib/payment-ledger";

const activeCompany = vi.mocked(getActiveCompanyFromRequest);
const removeAccount = vi.mocked(deletePaymentAccount); const removeEvent = vi.mocked(deletePaymentEvent); const editEvent = vi.mocked(updatePaymentEvent);
const request = (method: string, body?: unknown) => new NextRequest("http://localhost/api/test", { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const validEdit = { eventDate: "2026-09-09", eventType: "deposit", balanceDirection: "credit", balanceAmount: "1250", balanceAssetCode: "EUR", balanceAssetType: "fiat", reference: "Order 1" };

beforeEach(() => { vi.clearAllMocks(); activeCompany.mockResolvedValue({ id: 7 } as never); });

describe("payment-ledger mutation routes", () => {
  it("passes only the active company to account deletion and requires typed confirmation", async () => {
    expect((await deleteAccount(request("DELETE", {}), params("12"))).status).toBe(400);
    removeAccount.mockResolvedValue({ deleted: true });
    const response = await deleteAccount(request("DELETE", { confirmationName: "Testbank" }), params("12"));
    expect(response.status).toBe(200); expect(removeAccount).toHaveBeenCalledWith(7, 12, "Testbank");
  });

  it("passes only the active company to transaction edits and deletes", async () => {
    editEvent.mockResolvedValue({ id: 22 } as never); removeEvent.mockResolvedValue({ deleted: true });
    expect((await patchEvent(request("PATCH", validEdit), params("22"))).status).toBe(200);
    expect(editEvent).toHaveBeenCalledWith(7, 22, validEdit);
    expect((await deleteEvent(request("DELETE"), params("22"))).status).toBe(200);
    expect(removeEvent).toHaveBeenCalledWith(7, 22);
  });

  it("returns a conflict instead of deleting a linked or reconciled transaction", async () => {
    removeEvent.mockRejectedValue(new PaymentLedgerDependencyError("This transaction is used by a reconciliation run or match."));
    const response = await deleteEvent(request("DELETE"), params("22"));
    expect(response.status).toBe(409); expect((await response.json()).error).toMatch(/reconciliation/);
  });

  it("validates editable business fields before persistence", async () => {
    const response = await patchEvent(request("PATCH", { ...validEdit, balanceAssetType: "commodity" }), params("22"));
    expect(response.status).toBe(400); expect(editEvent).not.toHaveBeenCalled();
  });
});
