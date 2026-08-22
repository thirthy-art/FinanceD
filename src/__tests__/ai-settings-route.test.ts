import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/lib/ai-settings", () => ({
  getPublicAiSettings: vi.fn(),
  saveMimoSettings: vi.fn(),
  saveOpenRouterSettings: vi.fn(),
}));

import { getPublicAiSettings, saveMimoSettings, saveOpenRouterSettings } from "@/src/lib/ai-settings";
import { GET, PATCH } from "@/app/api/settings/ai/route";

const mockPublic = vi.mocked(getPublicAiSettings);
const mockSaveMimo = vi.mocked(saveMimoSettings);
const mockSaveOpenRouter = vi.mocked(saveOpenRouterSettings);
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
  mockPublic.mockResolvedValue(publicSettings);
});

describe("AI settings API privacy contract", () => {
  it("GET returns only models and configured flags", async () => {
    const response = await GET();
    expect(await response.json()).toEqual(publicSettings);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("empty key preserves the MiMo key while saving the model", async () => {
    const response = await patch({ provider: "mimo", model: "mimo-next", apiKey: "" });
    expect(response.status).toBe(200);
    expect(mockSaveMimo).toHaveBeenCalledWith({ model: "mimo-next", apiKey: undefined });
  });

  it("normalizes empty fallback 2 to disabled", async () => {
    await patch({ provider: "openrouter", fallback1Model: "xiaomi/mimo-v2.5", fallback2Model: "", apiKey: "" });
    expect(mockSaveOpenRouter).toHaveBeenCalledWith({
      fallback1Model: "xiaomi/mimo-v2.5", fallback2Model: null, apiKey: undefined,
    });
  });

  it("never echoes a submitted key in validation or save errors", async () => {
    const sentinel = "DO-NOT-RETURN-THIS-KEY";
    mockSaveMimo.mockRejectedValueOnce(new Error(sentinel));
    const response = await patch({ provider: "mimo", model: "mimo-v2.5", apiKey: sentinel });
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain(sentinel);
  });
});
