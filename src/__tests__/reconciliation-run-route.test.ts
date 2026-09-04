import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/src/lib/active-company", () => ({
  getActiveCompanyFromRequest: vi.fn(),
}));

vi.mock("@/src/lib/reconciliation", () => ({
  ReconciliationSelectionError: class ReconciliationSelectionError extends Error {},
  runAndPersistReconciliation: vi.fn(),
}));

import { POST } from "@/app/api/reconciliation/run/route";
import { getActiveCompanyFromRequest } from "@/src/lib/active-company";
import { runAndPersistReconciliation } from "@/src/lib/reconciliation";

const mockGetActiveCompany = vi.mocked(getActiveCompanyFromRequest);
const mockRun = vi.mocked(runAndPersistReconciliation);

function request(body: unknown) {
  return new NextRequest("http://localhost/api/reconciliation/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetActiveCompany.mockResolvedValue({ id: 7 } as never);
});

describe("reconciliation run API import selection", () => {
  it("rejects missing explicit import ids", async () => {
    const response = await POST(request({}));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid reconciliation import selection." });
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("does not silently use an older PSP import when only a ledger id is supplied", async () => {
    const response = await POST(request({ playerLedgerImportId: 22 }));
    expect(response.status).toBe(400);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("accepts and forwards an explicit ledger and PSP import pair", async () => {
    mockRun.mockResolvedValue({
      runId: 90,
      playerLedgerImportId: 22,
      pspImportId: 33,
      matches: [],
      ambiguousIds: [],
      matchedPlayerIds: [],
      matchedPspIds: [],
    });

    const response = await POST(request({ playerLedgerImportId: 22, pspImportId: 33 }));
    expect(response.status).toBe(200);
    expect(mockRun).toHaveBeenCalledWith(7, {
      playerLedgerImportId: 22,
      pspImportId: 33,
    });
    expect(await response.json()).toMatchObject({
      runId: 90,
      playerLedgerImportId: 22,
      pspImportId: 33,
    });
  });
});
