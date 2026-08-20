import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/db", () => ({ getDb: vi.fn() }));
vi.mock("@/src/lib/active-company", () => ({ getActiveCompanyFromRequest: vi.fn() }));

import { getDb } from "@/src/db";
import { getActiveCompanyFromRequest } from "@/src/lib/active-company";
import { POST as postBudgetEntries } from "@/app/api/budget/entries/route";
import { POST as postBudgetActual } from "@/app/api/budget/actuals/route";

const mockGetDb = vi.mocked(getDb);
const mockGetActiveCompany = vi.mocked(getActiveCompanyFromRequest);

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function atomicFailureDb() {
  const state: { committed: Array<Record<string, unknown>> } = { committed: [] };
  const transaction = vi.fn(async (callback: (tx: unknown) => unknown) => {
    const pending = [...state.committed];
    let writeCount = 0;
    const tx = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
      insert: vi.fn().mockImplementation(() => ({
        values: vi.fn().mockImplementation((values: Record<string, unknown>) => ({
          returning: vi.fn().mockImplementation(async () => {
            writeCount += 1;
            if (writeCount === 2) throw new Error("deterministic second-write failure");
            const row = { id: writeCount, ...values };
            pending.push(row);
            return [row];
          }),
        })),
      })),
    };

    try {
      const result = await callback(tx);
      state.committed = pending;
      return result;
    } catch (error) {
      throw error;
    }
  });

  const db = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: 1, companyId: 1 }]),
      }),
    }),
    transaction,
  };
  return { db, state, transaction };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetActiveCompany.mockResolvedValue({ id: 1 } as never);
});

describe("Budget route amount validation", () => {
  it("returns 400 for a non-finite Budget entry before database access", async () => {
    const response = await postBudgetEntries(jsonRequest("http://localhost/api/budget/entries", {
      budgetCategoryId: 1,
      month: "2026-08",
      amount: "NaN",
    }) as never);

    expect(response.status).toBe(400);
    expect(mockGetActiveCompany).not.toHaveBeenCalled();
    expect(mockGetDb).not.toHaveBeenCalled();
  });

  it("returns 400 for an over-scale manual actual before database access", async () => {
    const response = await postBudgetActual(jsonRequest("http://localhost/api/budget/actuals", {
      budgetCategoryId: 1,
      month: "2026-08",
      amount: "12.345",
    }) as never);

    expect(response.status).toBe(400);
    expect(mockGetActiveCompany).not.toHaveBeenCalled();
    expect(mockGetDb).not.toHaveBeenCalled();
  });
});

describe("Budget bulk POST atomicity", () => {
  it("rolls back the first write when a later write fails", async () => {
    const { db, state, transaction } = atomicFailureDb();
    mockGetDb.mockReturnValue(db as never);

    const request = jsonRequest("http://localhost/api/budget/entries", {
      entries: [
        { budgetCategoryId: 1, month: "2026-08", amount: "100.00" },
        { budgetCategoryId: 1, month: "2026-09", amount: "200.00" },
      ],
    });

    await expect(postBudgetEntries(request as never)).rejects.toThrow("deterministic second-write failure");
    expect(transaction).toHaveBeenCalledOnce();
    expect(state.committed).toEqual([]);
  });
});
