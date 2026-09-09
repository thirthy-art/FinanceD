import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ activeCompany: vi.fn(), candidate: vi.fn(), test: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/src/lib/active-company", () => ({ getActiveCompanyFromRequest: mocks.activeCompany }));
vi.mock("@/src/lib/ai-provider", () => ({ getAiTestCandidate: mocks.candidate }));
vi.mock("@/src/lib/ai-provider-chain", () => ({ testAiProviderConnection: mocks.test }));

import { POST } from "@/app/api/settings/ai/test/route";

function request(body: unknown) {
  return new Request("http://localhost/api/settings/ai/test", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.activeCompany.mockResolvedValue({ id: 44 });
});

describe("company AI provider test route", () => {
  it("rejects unauthorized tests before provider resolution", async () => {
    mocks.activeCompany.mockResolvedValue(new Response(null, { status: 403 }));
    const response = await POST(request({ provider: "mimo", model: "mimo-v2.5", apiKey: "secret" }));
    expect(response.status).toBe(403);
    expect(mocks.candidate).not.toHaveBeenCalled();
  });

  it("uses a transient key only for the authorized active company", async () => {
    const candidate = { provider: "openrouter", model: "model", endpoint: "https://example.test", fallbackLevel: 1, apiKey: "transient" };
    mocks.candidate.mockResolvedValue(candidate);
    mocks.test.mockResolvedValue({ ok: true, metadata: { provider: "openrouter", model: "model", fallbackLevel: 1 } });
    const response = await POST(request({ provider: "openrouter", model: "model", apiKey: "transient" }));
    expect(response.status).toBe(200);
    expect(mocks.candidate).toHaveBeenCalledWith({ companyId: 44, provider: "openrouter", model: "model", apiKey: "transient" });
    expect(JSON.stringify(await response.json())).not.toContain("transient");
  });

  it("never exposes a provider key through failures", async () => {
    const sentinel = "DO-NOT-RETURN-TEST-KEY";
    mocks.candidate.mockRejectedValue(new Error(sentinel));
    const response = await POST(request({ provider: "mimo", model: "mimo-v2.5", apiKey: sentinel }));
    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain(sentinel);
  });
});
