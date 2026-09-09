import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  activeCompany: vi.fn(), publicSettings: vi.fn(), saveMimo: vi.fn(), saveOpenRouter: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/src/lib/active-company", () => ({ getActiveCompanyFromRequest: mocks.activeCompany }));
vi.mock("@/src/lib/ai-settings", () => ({
  getPublicAiSettings: mocks.publicSettings,
  saveMimoSettings: mocks.saveMimo,
  saveOpenRouterSettings: mocks.saveOpenRouter,
}));

import { GET, PATCH } from "@/app/api/settings/ai/route";

const publicSettings = {
  mimo: { model: "mimo-v2.5", configured: true },
  openRouter: { configured: true, fallback1Model: "xiaomi/mimo-v2.5", fallback2Model: "" },
};

function patch(body: unknown) {
  return PATCH(new Request("http://localhost/api/settings/ai", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.activeCompany.mockResolvedValue({ id: 22 });
  mocks.publicSettings.mockResolvedValue(publicSettings);
});

describe("company AI settings API privacy", () => {
  it("returns only public flags/models for the authorized active company", async () => {
    const response = await GET(new Request("http://localhost/api/settings/ai"));
    const body = await response.json();
    expect(body).toEqual(publicSettings);
    expect(mocks.publicSettings).toHaveBeenCalledWith(22);
    expect(JSON.stringify(body)).not.toContain("apiKey");
  });

  it("fails closed before settings access when company authorization fails", async () => {
    mocks.activeCompany.mockResolvedValue(new Response(JSON.stringify({ error: "Authentication required." }), { status: 401 }));
    const response = await GET(new Request("http://localhost/api/settings/ai"));
    expect(response.status).toBe(401);
    expect(mocks.publicSettings).not.toHaveBeenCalled();
  });

  it("saves only under the authorized company and never echoes submitted keys", async () => {
    const sentinel = "DO-NOT-RETURN-THIS-KEY";
    const response = await patch({ provider: "mimo", model: "mimo-next", apiKey: sentinel });
    expect(mocks.saveMimo).toHaveBeenCalledWith(22, { model: "mimo-next", apiKey: sentinel });
    expect(JSON.stringify(await response.json())).not.toContain(sentinel);
  });

  it("normalizes empty fallback 2 without returning credentials", async () => {
    const response = await patch({ provider: "openrouter", fallback1Model: "xiaomi/mimo-v2.5", fallback2Model: "", apiKey: "" });
    expect(mocks.saveOpenRouter).toHaveBeenCalledWith(22, {
      fallback1Model: "xiaomi/mimo-v2.5", fallback2Model: null, apiKey: undefined,
    });
    expect(JSON.stringify(await response.json())).not.toContain("apiKey");
  });
});
