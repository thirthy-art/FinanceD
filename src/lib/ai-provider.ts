import "server-only";

import { decryptAiSecret } from "@/src/lib/ai-settings-crypto";
import {
  DEFAULT_MIMO_MODEL,
  DEFAULT_OPENROUTER_FALLBACK_1_MODEL,
  readAiSettings,
} from "@/src/lib/ai-settings";

export const MIMO_BASE_URL = "https://api.xiaomimimo.com/v1";
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export type AiProviderName = "mimo-direct" | "openrouter" | "legacy-openai-compatible";

export interface AiProviderCandidate {
  provider: AiProviderName;
  model: string;
  endpoint: string;
  fallbackLevel: 0 | 1 | 2;
  apiKey?: string;
  configurationError?: true;
}

function endpoint(baseUrlValue: string): string | null {
  try {
    const value = new URL(baseUrlValue);
    if (value.protocol !== "https:" && value.protocol !== "http:") return null;
    value.search = "";
    value.hash = "";
    return `${value.toString().replace(/\/$/, "")}/chat/completions`;
  } catch {
    return null;
  }
}

function providerNameForEndpoint(value: string): AiProviderName {
  try {
    return new URL(value).hostname.endsWith("xiaomimimo.com")
      ? "mimo-direct"
      : "legacy-openai-compatible";
  } catch {
    return "legacy-openai-compatible";
  }
}

function legacyMimoCandidate(modelOverride?: string): AiProviderCandidate | null {
  const apiKey = (process.env.AI_API_KEY || process.env.MIMO_API_KEY)?.trim();
  if (!apiKey) return null;
  const model = (modelOverride || process.env.AI_MODEL || process.env.MIMO_MODEL || DEFAULT_MIMO_MODEL).trim();
  const baseUrl = (process.env.AI_BASE_URL || process.env.MIMO_BASE_URL || MIMO_BASE_URL).trim();
  const resolvedEndpoint = endpoint(baseUrl);
  if (!model || model.length > 200 || !resolvedEndpoint) {
    return {
      provider: providerNameForEndpoint(baseUrl),
      model: model || DEFAULT_MIMO_MODEL,
      endpoint: resolvedEndpoint ?? `${MIMO_BASE_URL}/chat/completions`,
      fallbackLevel: 0,
      configurationError: true,
    };
  }
  return {
    provider: providerNameForEndpoint(baseUrl),
    model,
    endpoint: resolvedEndpoint,
    apiKey,
    fallbackLevel: 0,
  };
}

function configuredMimoModel(model: string | null | undefined): string {
  return (model || process.env.AI_MODEL || process.env.MIMO_MODEL || DEFAULT_MIMO_MODEL).trim();
}

function encryptedCandidate(input: Omit<AiProviderCandidate, "apiKey" | "configurationError"> & {
  encryptedKey: string;
  secretKind: "mimo" | "openrouter";
}): AiProviderCandidate {
  const { encryptedKey, secretKind, ...candidate } = input;
  try {
    return { ...candidate, apiKey: decryptAiSecret(encryptedKey, secretKind) };
  } catch {
    return { ...candidate, configurationError: true };
  }
}

export async function getAiProviderCandidates(): Promise<AiProviderCandidate[]> {
  const settings = await readAiSettings();
  if (!settings) {
    const legacy = legacyMimoCandidate();
    return legacy ? [legacy] : [];
  }

  const candidates: AiProviderCandidate[] = [];
  if (settings.mimoApiKeyEncrypted) {
    candidates.push(encryptedCandidate({
      provider: "mimo-direct",
      model: configuredMimoModel(settings.mimoModel),
      endpoint: `${MIMO_BASE_URL}/chat/completions`,
      fallbackLevel: 0,
      encryptedKey: settings.mimoApiKeyEncrypted,
      secretKind: "mimo",
    }));
  } else {
    const legacy = legacyMimoCandidate(settings.mimoModel ?? undefined);
    if (legacy) candidates.push(legacy);
  }

  if (settings.openrouterApiKeyEncrypted) {
    candidates.push(encryptedCandidate({
      provider: "openrouter",
      model: settings.openrouterFallback1Model,
      endpoint: `${OPENROUTER_BASE_URL}/chat/completions`,
      fallbackLevel: 1,
      encryptedKey: settings.openrouterApiKeyEncrypted,
      secretKind: "openrouter",
    }));
    if (settings.openrouterFallback2Model) {
      candidates.push(encryptedCandidate({
        provider: "openrouter",
        model: settings.openrouterFallback2Model,
        endpoint: `${OPENROUTER_BASE_URL}/chat/completions`,
        fallbackLevel: 2,
        encryptedKey: settings.openrouterApiKeyEncrypted,
        secretKind: "openrouter",
      }));
    }
  }
  return candidates;
}

export async function getAiTestCandidate(input: {
  provider: "mimo" | "openrouter";
  model: string;
  apiKey?: string;
}): Promise<AiProviderCandidate | null> {
  const settings = await readAiSettings();
  const provider = input.provider === "mimo" ? "mimo-direct" : "openrouter";
  const testEndpoint = input.provider === "mimo"
    ? `${MIMO_BASE_URL}/chat/completions`
    : `${OPENROUTER_BASE_URL}/chat/completions`;

  if (input.apiKey) {
    return { provider, model: input.model, endpoint: testEndpoint, apiKey: input.apiKey, fallbackLevel: input.provider === "mimo" ? 0 : 1 };
  }

  if (input.provider === "mimo") {
    if (settings?.mimoApiKeyEncrypted) {
      return encryptedCandidate({
        provider,
        model: input.model,
        endpoint: testEndpoint,
        fallbackLevel: 0,
        encryptedKey: settings.mimoApiKeyEncrypted,
        secretKind: "mimo",
      });
    }
    const legacy = legacyMimoCandidate(input.model);
    return legacy ? { ...legacy, model: input.model } : null;
  }

  if (!settings?.openrouterApiKeyEncrypted) return null;
  return encryptedCandidate({
    provider,
    model: input.model || DEFAULT_OPENROUTER_FALLBACK_1_MODEL,
    endpoint: testEndpoint,
    fallbackLevel: 1,
    encryptedKey: settings.openrouterApiKeyEncrypted,
    secretKind: "openrouter",
  });
}
