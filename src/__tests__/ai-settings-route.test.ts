import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/ai-settings", () => ({
  getPublicAiSettings: vi.fn(),
  saveMimoSettings: vi.fn(),
  saveOpenRouterSettings: vi.fn(),
}));

import { getPublicAiSettings, saveMimoSettings, saveOpenRouterSettings } from "@/src/lib/ai-settings";
import { AI_SETTINGS_ADMIN_COOKIE, createAiSettingsAdminToken } from "@/src/lib/ai-settings-admin-auth";
import { GET, PATCH } from "@/app/api/settings/ai/route";

const mockPublic = vi.mocked(getPublicAiSettings);
const mockSaveMimo = vi.mocked(saveMimoSettings);
const mockSaveOpenRouter = vi.mocked(saveOpenRouterSettings);
const originalAdminSecret = process.env.AI_SETTINGS_ADMIN_SECRET;
const publicSettings = {
  mimo: { model: "mimo-v2.5", configured: true },
  openRouter: { configured: true, fallback1Model: "xiaomi/mimo-v2.5", fallback2Model: "" },
};

function cookieHeader() {
  return `${AI_SETTINGS_ADMIN_COOKIE}=${createAiSettingsAdminToken()}`;
}

function get(authorized = true) {
  return GET(new Request("http://localhost/api/settings/ai", {
    headers: authorized ? { Cookie: cookieHeader() } : undefined,
  }));
}

function patch(body: unknown, authorized = true) {
  return PATCH(new Request("http://localhost/api/settings/ai", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(authorized ? { Cookie: cookieHeader() } : {}),
    },
    body: JSON.stringify(body),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AI_SETTINGS_ADMIN_SECRET = "route-test-admin-secret";
  mockPublic.mockResolvedValue(publicSettings);
});

afterAll(() => {
  if (originalAdminSecret === undefined) delete process.env.AI_SETTINGS_ADMIN_SECRET;
  else process.env.AI_SETTINGS_ADMIN_SECRET = originalAdminSecret;
});

describe("AI settings API privacy contract", () => {
  it("GET returns only models and configured flags", async () => {
    const response = await get();
    expect(await response.json()).toEqual(publicSettings);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects unauthorized GET without revealing configured state", async () => {
    const response = await get(false);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized." });
    expect(mockPublic).not.toHaveBeenCalled();
  });

  it("rejects unauthorized PATCH before parsing or saving settings", async () => {
    const sentinel = "UNAUTHORIZED-REPLACEMENT-MUST-NOT-LEAK";
    const response = await patch({ provider: "mimo", model: "mimo-next", apiKey: sentinel }, false);
    expect(response.status).toBe(401);
    expect(JSON.stringify(await response.json())).not.toContain(sentinel);
    expect(mockSaveMimo).not.toHaveBeenCalled();
    expect(mockSaveOpenRouter).not.toHaveBeenCalled();
  });

  it("fails closed without reading settings when admin access is not configured", async () => {
    delete process.env.AI_SETTINGS_ADMIN_SECRET;
    const response = await get(false);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "AI settings admin access is not configured.",
      code: "AI_SETTINGS_ADMIN_NOT_CONFIGURED",
    });
    expect(mockPublic).not.toHaveBeenCalled();
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
