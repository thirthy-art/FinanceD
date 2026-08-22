import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/ai-provider", () => ({ getAiTestCandidate: vi.fn() }));
vi.mock("@/src/lib/ai-provider-chain", () => ({ testAiProviderConnection: vi.fn() }));

import { getAiTestCandidate } from "@/src/lib/ai-provider";
import { testAiProviderConnection } from "@/src/lib/ai-provider-chain";
import { AI_SETTINGS_ADMIN_COOKIE, createAiSettingsAdminToken } from "@/src/lib/ai-settings-admin-auth";
import { POST } from "@/app/api/settings/ai/test/route";

const mockCandidate = vi.mocked(getAiTestCandidate);
const mockTest = vi.mocked(testAiProviderConnection);
const originalAdminSecret = process.env.AI_SETTINGS_ADMIN_SECRET;

function request(body: unknown, authorized = true) {
  return new Request("http://localhost/api/settings/ai/test", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authorized ? { Cookie: `${AI_SETTINGS_ADMIN_COOKIE}=${createAiSettingsAdminToken()}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AI_SETTINGS_ADMIN_SECRET = "test-route-admin-secret";
});

afterAll(() => {
  if (originalAdminSecret === undefined) delete process.env.AI_SETTINGS_ADMIN_SECRET;
  else process.env.AI_SETTINGS_ADMIN_SECRET = originalAdminSecret;
});

describe("AI provider connection test route", () => {
  it("rejects unauthorized provider tests before provider resolution", async () => {
    const sentinel = "UNAUTHORIZED-TEST-KEY-MUST-NOT-LEAK";
    const response = await POST(request({ provider: "mimo", model: "mimo-v2.5", apiKey: sentinel }, false));
    expect(response.status).toBe(401);
    expect(JSON.stringify(await response.json())).not.toContain(sentinel);
    expect(mockCandidate).not.toHaveBeenCalled();
    expect(mockTest).not.toHaveBeenCalled();
  });

  it("uses an unsaved key transiently for only the selected provider and model", async () => {
    const candidate = {
      provider: "openrouter" as const,
      model: "xiaomi/mimo-v2.5",
      endpoint: "https://openrouter.ai/api/v1/chat/completions",
      fallbackLevel: 1 as const,
      apiKey: "transient-key",
    };
    mockCandidate.mockResolvedValue(candidate);
    mockTest.mockResolvedValue({ ok: true, metadata: { provider: "openrouter", model: candidate.model, fallbackLevel: 1 } });
    const response = await POST(request({ provider: "openrouter", model: candidate.model, apiKey: "transient-key" }));
    expect(response.status).toBe(200);
    expect(mockCandidate).toHaveBeenCalledWith({ provider: "openrouter", model: candidate.model, apiKey: "transient-key" });
    expect(mockTest).toHaveBeenCalledWith(candidate);
  });

  it("does not expose submitted keys or upstream failures", async () => {
    const sentinel = "DO-NOT-RETURN-TEST-KEY";
    mockCandidate.mockRejectedValueOnce(new Error(sentinel));
    const response = await POST(request({ provider: "mimo", model: "mimo-v2.5", apiKey: sentinel }));
    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain(sentinel);
  });

  it("rejects control characters in model slugs before provider resolution", async () => {
    const response = await POST(request({ provider: "mimo", model: "mimo-v2.5\nforged", apiKey: "key" }));
    expect(response.status).toBe(400);
    expect(mockCandidate).not.toHaveBeenCalled();
  });
});
