import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetAuthorizedCompanies } = vi.hoisted(() => ({ mockGetAuthorizedCompanies: vi.fn() }));
vi.mock("@/src/lib/active-company", () => ({
  AuthenticationRequiredError: class AuthenticationRequiredError extends Error {
    code = "AUTHENTICATION_REQUIRED";
    constructor() { super("Authentication required."); }
  },
  getAuthorizedCompanies: mockGetAuthorizedCompanies,
  activeCompanyIdFromRequest(request: Request) {
    const match = request.headers.get("cookie")?.match(/(?:^|;\s*)financed_company_id=(\d+)/);
    return match ? Number(match[1]) : null;
  },
  setActiveCompanyCookie(response: Response, companyId: number) {
    response.headers.append("Set-Cookie", `financed_company_id=${companyId}; Path=/; HttpOnly; SameSite=lax`);
    return response;
  },
}));

import { AuthenticationRequiredError } from "@/src/lib/active-company";
import { GET, POST as createCompany } from "@/app/api/companies/route";
import { POST as selectCompany } from "@/app/api/companies/active/route";

const rows = [
  { id: 1, name: "Company A", baseCurrency: "EUR", createdAt: new Date(), updatedAt: new Date() },
  { id: 2, name: "Company B", baseCurrency: "GBP", createdAt: new Date(), updatedAt: new Date() },
];

function request(url: string, body?: unknown, cookie?: string) {
  return new Request(url, body === undefined ? { headers: cookie ? { Cookie: cookie } : undefined } : {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthorizedCompanies.mockResolvedValue(rows);
});

describe("authorized company API", () => {
  it("lists only memberships and preserves an authorized selection", async () => {
    mockGetAuthorizedCompanies.mockResolvedValue([rows[1]]);
    const response = await GET(request("http://localhost/api/companies", undefined, "financed_company_id=2"));
    expect(await response.json()).toEqual({
      companies: [{ id: 2, name: "Company B", baseCurrency: "GBP" }],
      activeCompanyId: 2,
    });
  });

  it("returns null selection for multiple memberships without a cookie", async () => {
    const response = await GET(request("http://localhost/api/companies"));
    expect((await response.json()).activeCompanyId).toBeNull();
  });

  it("fails unauthenticated listing closed", async () => {
    mockGetAuthorizedCompanies.mockRejectedValue(new AuthenticationRequiredError());
    const response = await GET(request("http://localhost/api/companies"));
    expect(response.status).toBe(401);
  });

  it("allows selecting only a company in the user's memberships", async () => {
    mockGetAuthorizedCompanies.mockResolvedValue([rows[0]]);
    const denied = await selectCompany(request("http://localhost/api/companies/active", { companyId: 2 }));
    expect(denied.status).toBe(404);
    expect(denied.headers.get("set-cookie")).toBeNull();

    const allowed = await selectCompany(request("http://localhost/api/companies/active", { companyId: 1 }));
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("set-cookie")).toContain("financed_company_id=1");
  });

  it("does not expose company creation through HTTP", async () => {
    const response = await createCompany(request("http://localhost/api/companies", { name: "Tenant", baseCurrency: "EUR" }));
    expect(response.status).toBe(405);
  });
});
