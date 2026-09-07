import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/src/lib/ai-settings", () => ({
  DEFAULT_MIMO_MODEL: "mimo-v2.5",
  DEFAULT_OPENROUTER_FALLBACK_1_MODEL: "xiaomi/mimo-v2.5",
  defaultMimoModel: vi.fn(() => process.env.NODE_ENV === "production"
    ? "mimo-v2.5"
    : process.env.AI_MODEL || process.env.MIMO_MODEL || "mimo-v2.5"),
  readAiSettings: vi.fn(),
  legacyLocalAiEnvironmentEnabled: vi.fn(() =>
    process.env.NODE_ENV !== "production" && process.env.AI_LEGACY_LOCAL_DEVELOPMENT === "true"),
}));
vi.mock("@/src/lib/ai-settings-crypto", () => ({
  decryptAiSecret: vi.fn((value: string) => `plain:${value}`),
}));

import { readAiSettings } from "@/src/lib/ai-settings";
import { getAiProviderCandidates } from "@/src/lib/ai-provider";

const mockRead = vi.mocked(readAiSettings);
const envNames = ["AI_API_KEY", "AI_BASE_URL", "AI_MODEL", "MIMO_API_KEY", "MIMO_BASE_URL", "MIMO_MODEL", "AI_LEGACY_LOCAL_DEVELOPMENT"] as const;
const originalEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));

beforeEach(() => {
  vi.clearAllMocks();
  for (const name of envNames) delete process.env[name];
  vi.stubEnv("NODE_ENV", "test");
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const name of envNames) {
    const value = originalEnv[name];
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});

function row(overrides: Record<string, unknown> = {}) {
  return {
    companyId: 7,
    mimoModel: "mimo-v2.5",
    mimoApiKeyEncrypted: "mimo-ciphertext",
    openrouterApiKeyEncrypted: "openrouter-ciphertext",
    openrouterFallback1Model: "xiaomi/mimo-v2.5",
    openrouterFallback2Model: "anthropic/secondary",
    createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  } as Awaited<ReturnType<typeof readAiSettings>>;
}

describe("runtime provider settings resolution", () => {
  it("preserves the legacy OpenAI-compatible environment bootstrap when no DB row exists", async () => {
    mockRead.mockResolvedValue(null);
    process.env.AI_API_KEY = "legacy-key";
    process.env.AI_BASE_URL = "https://legacy.example/v1";
    process.env.AI_MODEL = "legacy-model";
    process.env.AI_LEGACY_LOCAL_DEVELOPMENT = "true";
    expect(await getAiProviderCandidates(7)).toEqual([expect.objectContaining({
      provider: "legacy-openai-compatible",
      endpoint: "https://legacy.example/v1/chat/completions",
      model: "legacy-model",
      apiKey: "legacy-key",
      fallbackLevel: 0,
    })]);
  });

  it("uses fixed endpoints and fixed fallback order for DB configuration", async () => {
    mockRead.mockResolvedValue(row());
    const candidates = await getAiProviderCandidates(7);
    expect(candidates.map(({ provider, model, endpoint, fallbackLevel }) => ({ provider, model, endpoint, fallbackLevel }))).toEqual([
      { provider: "mimo-direct", model: "mimo-v2.5", endpoint: "https://api.xiaomimimo.com/v1/chat/completions", fallbackLevel: 0 },
      { provider: "openrouter", model: "xiaomi/mimo-v2.5", endpoint: "https://openrouter.ai/api/v1/chat/completions", fallbackLevel: 1 },
      { provider: "openrouter", model: "anthropic/secondary", endpoint: "https://openrouter.ai/api/v1/chat/completions", fallbackLevel: 2 },
    ]);
  });

  it("keeps an environment key usable after a model-only first save", async () => {
    mockRead.mockResolvedValue(row({ mimoApiKeyEncrypted: null, openrouterApiKeyEncrypted: null }));
    process.env.MIMO_API_KEY = "bootstrap-key";
    process.env.MIMO_BASE_URL = "https://api.xiaomimimo.com/v1";
    process.env.AI_LEGACY_LOCAL_DEVELOPMENT = "true";
    const candidates = await getAiProviderCandidates(7);
    expect(candidates).toEqual([expect.objectContaining({ model: "mimo-v2.5", apiKey: "bootstrap-key", fallbackLevel: 0 })]);
  });

  it("preserves the complete legacy MiMo config after an OpenRouter-only first save", async () => {
    mockRead.mockResolvedValue(row({ mimoModel: null, mimoApiKeyEncrypted: null }));
    process.env.AI_API_KEY = "legacy-key";
    process.env.AI_MODEL = "legacy-vision-model";
    process.env.AI_BASE_URL = "https://legacy.example/v7";
    process.env.AI_LEGACY_LOCAL_DEVELOPMENT = "true";
    const candidates = await getAiProviderCandidates(7);
    expect(candidates[0]).toEqual(expect.objectContaining({
      provider: "legacy-openai-compatible",
      model: "legacy-vision-model",
      endpoint: "https://legacy.example/v7/chat/completions",
      apiKey: "legacy-key",
      fallbackLevel: 0,
    }));
    expect(candidates.slice(1).map((candidate) => candidate.fallbackLevel)).toEqual([1, 2]);
  });

  it("disables fallback 2 when its model slug is empty", async () => {
    mockRead.mockResolvedValue(row({ openrouterFallback2Model: null }));
    expect((await getAiProviderCandidates(7)).map((candidate) => candidate.fallbackLevel)).toEqual([0, 1]);
  });

  it("does not use deployment-global credentials for an unconfigured production tenant", async () => {
    mockRead.mockResolvedValue(null);
    vi.stubEnv("NODE_ENV", "production");
    process.env.AI_LEGACY_LOCAL_DEVELOPMENT = "true";
    process.env.AI_API_KEY = "operator-global-key";
    await expect(getAiProviderCandidates(99)).resolves.toEqual([]);
  });

  it("resolves credentials from only the requested company's settings", async () => {
    mockRead.mockImplementation(async (companyId) => companyId === 7 ? row() : null);
    const companyA = await getAiProviderCandidates(7);
    const companyB = await getAiProviderCandidates(8);
    expect(companyA[0]?.apiKey).toBe("plain:mimo-ciphertext");
    expect(companyB).toEqual([]);
    expect(mockRead).toHaveBeenCalledWith(7);
    expect(mockRead).toHaveBeenCalledWith(8);
  });
});
