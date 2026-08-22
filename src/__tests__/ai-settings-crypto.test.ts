import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

vi.mock("server-only", () => ({}));

import { decryptAiSecret, encryptAiSecret } from "@/src/lib/ai-settings-crypto";

const originalKey = process.env.AI_SETTINGS_ENCRYPTION_KEY;

beforeEach(() => {
  process.env.AI_SETTINGS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.AI_SETTINGS_ENCRYPTION_KEY;
  else process.env.AI_SETTINGS_ENCRYPTION_KEY = originalKey;
});

describe("AI settings authenticated encryption", () => {
  it("round-trips without storing plaintext and uses a fresh IV", () => {
    const first = encryptAiSecret("secret-provider-key", "mimo");
    const second = encryptAiSecret("secret-provider-key", "mimo");
    expect(first).not.toContain("secret-provider-key");
    expect(first).not.toBe(second);
    expect(decryptAiSecret(first, "mimo")).toBe("secret-provider-key");
  });

  it("rejects tampering, a wrong master key, and provider swapping", () => {
    const encrypted = encryptAiSecret("secret-provider-key", "mimo");
    const parts = encrypted.split(".");
    parts[3] = `${parts[3][0] === "A" ? "B" : "A"}${parts[3].slice(1)}`;
    expect(() => decryptAiSecret(parts.join("."), "mimo")).toThrow("AI settings encryption is unavailable.");
    expect(() => decryptAiSecret(encrypted, "openrouter")).toThrow("AI settings encryption is unavailable.");
    process.env.AI_SETTINGS_ENCRYPTION_KEY = Buffer.alloc(32, 8).toString("base64");
    expect(() => decryptAiSecret(encrypted, "mimo")).toThrow("AI settings encryption is unavailable.");
  });

  it("requires a base64-encoded 32-byte deployment key", () => {
    process.env.AI_SETTINGS_ENCRYPTION_KEY = "not-a-valid-master-key";
    expect(() => encryptAiSecret("secret", "mimo")).toThrow("AI settings encryption is unavailable.");
  });
});
