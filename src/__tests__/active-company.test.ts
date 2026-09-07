import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));

import {
  ACTIVE_COMPANY_COOKIE,
  ActiveCompanySelectionRequiredError,
  getActiveCompanyFromRequest,
  NoCompanyAssignedError,
  parseActiveCompanyId,
  resolveActiveCompany,
  type ActiveCompanyDependencies,
  type AuthorizedCompany,
} from "@/src/lib/active-company";

const userA = { id: "user-a", email: "a@example.com", name: "User A" };
const companyA = company(1, "Company A");
const companyB = company(2, "Company B");

function company(id: number, name: string): AuthorizedCompany {
  return { id, name, baseCurrency: "EUR", createdAt: new Date(0), updatedAt: new Date(0) };
}

function dependencies(companies: AuthorizedCompany[], authenticated = true): ActiveCompanyDependencies {
  return {
    getUser: vi.fn().mockResolvedValue(authenticated ? userA : null),
    listCompanies: vi.fn().mockResolvedValue(companies),
  };
}

describe("authenticated active-company boundary", () => {
  it("parses only positive safe integer cookie values", () => {
    expect(ACTIVE_COMPANY_COOKIE).toBe("financed_company_id");
    expect(parseActiveCompanyId("42")).toBe(42);
    expect(parseActiveCompanyId("0")).toBeNull();
    expect(parseActiveCompanyId("1x")).toBeNull();
    expect(parseActiveCompanyId("9007199254740992")).toBeNull();
  });

  it("rejects unauthenticated API access with 401", async () => {
    const response = await getActiveCompanyFromRequest(
      new Request("http://localhost/api/invoices"), dependencies([], false),
    );
    expect(response).toBeInstanceOf(Response);
    if (!(response instanceof Response)) throw new Error("Expected a response.");
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
  });

  it("resolves Company A for User A's membership", async () => {
    await expect(resolveActiveCompany("1", dependencies([companyA]))).resolves.toEqual(companyA);
  });

  it("resolves Company B for User B's membership", async () => {
    const deps = dependencies([companyB]);
    deps.getUser = vi.fn().mockResolvedValue({ id: "user-b", email: "b@example.com", name: "User B" });
    await expect(resolveActiveCompany("2", deps)).resolves.toEqual(companyB);
  });

  it("never grants Company B when User A forges the Company B cookie", async () => {
    await expect(resolveActiveCompany("2", dependencies([companyA]))).resolves.toEqual(companyA);
  });

  it("safely falls back when the user has exactly one membership", async () => {
    await expect(resolveActiveCompany(undefined, dependencies([companyA]))).resolves.toEqual(companyA);
  });

  it("requires selection for multiple memberships without a valid selection", async () => {
    await expect(resolveActiveCompany(undefined, dependencies([companyA, companyB])))
      .rejects.toBeInstanceOf(ActiveCompanySelectionRequiredError);
    const response = await getActiveCompanyFromRequest(
      new Request("http://localhost/api/invoices"), dependencies([companyA, companyB]),
    );
    expect(response).toBeInstanceOf(Response);
    if (!(response instanceof Response)) throw new Error("Expected a response.");
    expect(response.status).toBe(409);
  });

  it("returns no-company-assigned for zero memberships", async () => {
    await expect(resolveActiveCompany(undefined, dependencies([])))
      .rejects.toBeInstanceOf(NoCompanyAssignedError);
    const response = await getActiveCompanyFromRequest(
      new Request("http://localhost/api/invoices"), dependencies([]),
    );
    expect(response).toBeInstanceOf(Response);
    if (!(response instanceof Response)) throw new Error("Expected a response.");
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "NO_COMPANY_ASSIGNED" });
  });
});
