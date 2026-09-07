import "server-only";

import { eq } from "drizzle-orm";
import { getDb } from "@/src/db";
import { companyAiSettings } from "@/src/db/schema";
import { encryptAiSecret } from "@/src/lib/ai-settings-crypto";

export const DEFAULT_MIMO_MODEL = "mimo-v2.5";
export const DEFAULT_OPENROUTER_FALLBACK_1_MODEL = "xiaomi/mimo-v2.5";
export type AiSettingsRecord = typeof companyAiSettings.$inferSelect;

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

export async function readAiSettings(companyId: number): Promise<AiSettingsRecord | null> {
  try {
    const [settings] = await getDb()
      .select()
      .from(companyAiSettings)
      .where(eq(companyAiSettings.companyId, companyId))
      .limit(1);
    return settings ?? null;
  } catch (error) {
    // Keep the legacy environment bootstrap usable during a migration-safe rollout
    // where application code may briefly start before the additive table exists.
    if (isUndefinedTableError(error)) return null;
    throw error;
  }
}

export function legacyLocalAiEnvironmentEnabled(): boolean {
  return process.env.NODE_ENV !== "production"
    && process.env.AI_LEGACY_LOCAL_DEVELOPMENT === "true";
}

export function defaultMimoModel(): string {
  if (!legacyLocalAiEnvironmentEnabled()) return DEFAULT_MIMO_MODEL;
  return (process.env.AI_MODEL || process.env.MIMO_MODEL || DEFAULT_MIMO_MODEL).trim();
}

function legacyMimoKeyConfigured(): boolean {
  if (!legacyLocalAiEnvironmentEnabled()) return false;
  return Boolean((process.env.AI_API_KEY || process.env.MIMO_API_KEY)?.trim());
}

export async function getPublicAiSettings(companyId: number) {
  const settings = await readAiSettings(companyId);
  return {
    mimo: {
      model: settings?.mimoModel ?? defaultMimoModel(),
      configured: Boolean(settings?.mimoApiKeyEncrypted) || legacyMimoKeyConfigured(),
    },
    openRouter: {
      configured: Boolean(settings?.openrouterApiKeyEncrypted),
      fallback1Model: settings?.openrouterFallback1Model ?? DEFAULT_OPENROUTER_FALLBACK_1_MODEL,
      fallback2Model: settings?.openrouterFallback2Model ?? "",
    },
  };
}

export async function saveMimoSettings(companyId: number, input: { model: string; apiKey?: string }) {
  const encryptedKey = input.apiKey ? encryptAiSecret(input.apiKey, "mimo") : undefined;
  const now = new Date();
  await getDb()
    .insert(companyAiSettings)
    .values({
      companyId,
      mimoModel: input.model,
      ...(encryptedKey === undefined ? {} : { mimoApiKeyEncrypted: encryptedKey }),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: companyAiSettings.companyId,
      set: {
        mimoModel: input.model,
        ...(encryptedKey === undefined ? {} : { mimoApiKeyEncrypted: encryptedKey }),
        updatedAt: now,
      },
    });
}

export async function saveOpenRouterSettings(companyId: number, input: {
  fallback1Model: string;
  fallback2Model: string | null;
  apiKey?: string;
}) {
  const encryptedKey = input.apiKey ? encryptAiSecret(input.apiKey, "openrouter") : undefined;
  const now = new Date();
  await getDb()
    .insert(companyAiSettings)
    .values({
      companyId,
      openrouterFallback1Model: input.fallback1Model,
      openrouterFallback2Model: input.fallback2Model,
      ...(encryptedKey === undefined ? {} : { openrouterApiKeyEncrypted: encryptedKey }),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: companyAiSettings.companyId,
      set: {
        openrouterFallback1Model: input.fallback1Model,
        openrouterFallback2Model: input.fallback2Model,
        ...(encryptedKey === undefined ? {} : { openrouterApiKeyEncrypted: encryptedKey }),
        updatedAt: now,
      },
    });
}
