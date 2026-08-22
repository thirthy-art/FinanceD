import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/lib/ai-provider", () => ({ getAiTestCandidate: vi.fn() }));
vi.mock("@/src/lib/ai-provider-chain", () => ({ testAiProviderConnection: vi.fn() }));

import { getAiTestCandidate } from "@/src/lib/ai-provider";
import { testAiProviderConnection } from "@/src/lib/ai-provider-chain";
import { POST } from "@/app/api/settings/ai/test/route";

const mockCandidate = vi.mocked(getAiTestCandidate);
const mockTest = vi.mocked(testAiProviderConnection);

function request(body: unknown) {
  return new Request("http://localhost/api/settings/ai/test", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

beforeEach(() => vi.clearAllMocks());

describe("AI provider connection test route", () => {
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
