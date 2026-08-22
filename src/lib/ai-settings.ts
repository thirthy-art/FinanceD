import "server-only";

import { eq } from "drizzle-orm";
import { getDb } from "@/src/db";
import { aiSettings } from "@/src/db/schema";
import { encryptAiSecret } from "@/src/lib/ai-settings-crypto";

export const DEFAULT_MIMO_MODEL = "mimo-v2.5";
export const DEFAULT_OPENROUTER_FALLBACK_1_MODEL = "xiaomi/mimo-v2.5";
export const AI_SETTINGS_ID = 1;

export type AiSettingsRecord = typeof aiSettings.$inferSelect;

function isUndefinedTableError(error: unknown): boolean {
  const visited = new Set<unknown>();
  let current = error;
  while (typeof current === "object" && current !== null && !visited.has(current)) {
    visited.add(current);
    if ("code" in current && current.code === "42P01") return true;
    current = "cause" in current ? current.cause : null;
  }
  return false;
}

export async function readAiSettings(): Promise<AiSettingsRecord | null> {
  try {
    const [settings] = await getDb()
      .select()
      .from(aiSettings)
      .where(eq(aiSettings.id, AI_SETTINGS_ID))
      .limit(1);
    return settings ?? null;
  } catch (error) {
    // Keep the legacy environment bootstrap usable during a migration-safe rollout
    // where application code may briefly start before the additive table exists.
    if (isUndefinedTableError(error)) return null;
    throw error;
  }
}

function legacyMimoKeyConfigured(): boolean {
  return Boolean((process.env.AI_API_KEY || process.env.MIMO_API_KEY)?.trim());
}

export async function getPublicAiSettings() {
  const settings = await readAiSettings();
  return {
    mimo: {
      model: settings?.mimoModel ?? (process.env.AI_MODEL || process.env.MIMO_MODEL || DEFAULT_MIMO_MODEL).trim(),
      configured: Boolean(settings?.mimoApiKeyEncrypted) || legacyMimoKeyConfigured(),
    },
    openRouter: {
      configured: Boolean(settings?.openrouterApiKeyEncrypted),
      fallback1Model: settings?.openrouterFallback1Model ?? DEFAULT_OPENROUTER_FALLBACK_1_MODEL,
      fallback2Model: settings?.openrouterFallback2Model ?? "",
    },
  };
}

export async function saveMimoSettings(input: { model: string; apiKey?: string }) {
  const encryptedKey = input.apiKey ? encryptAiSecret(input.apiKey, "mimo") : undefined;
  const now = new Date();
  await getDb()
    .insert(aiSettings)
    .values({
      id: AI_SETTINGS_ID,
      mimoModel: input.model,
      ...(encryptedKey === undefined ? {} : { mimoApiKeyEncrypted: encryptedKey }),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: aiSettings.id,
      set: {
        mimoModel: input.model,
        ...(encryptedKey === undefined ? {} : { mimoApiKeyEncrypted: encryptedKey }),
        updatedAt: now,
      },
    });
}

export async function saveOpenRouterSettings(input: {
  fallback1Model: string;
  fallback2Model: string | null;
  apiKey?: string;
}) {
  const encryptedKey = input.apiKey ? encryptAiSecret(input.apiKey, "openrouter") : undefined;
  const now = new Date();
  await getDb()
    .insert(aiSettings)
    .values({
      id: AI_SETTINGS_ID,
      openrouterFallback1Model: input.fallback1Model,
      openrouterFallback2Model: input.fallback2Model,
      ...(encryptedKey === undefined ? {} : { openrouterApiKeyEncrypted: encryptedKey }),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: aiSettings.id,
      set: {
        openrouterFallback1Model: input.fallback1Model,
        openrouterFallback2Model: input.fallback2Model,
        ...(encryptedKey === undefined ? {} : { openrouterApiKeyEncrypted: encryptedKey }),
        updatedAt: now,
      },
    });
}
