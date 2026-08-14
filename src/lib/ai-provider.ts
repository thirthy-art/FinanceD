import "server-only";

const DEFAULT_BASE_URL = "https://api.xiaomimimo.com/v1";
const DEFAULT_MODEL = "mimo-v2.5";

export type AiProviderConfigResult =
  | { ok: true; apiKey: string; model: string; endpoint: string }
  | { ok: false; error: string };

export function getAiProviderConfig(): AiProviderConfigResult {
  const apiKey = (process.env.AI_API_KEY || process.env.MIMO_API_KEY)?.trim();
  const model = (process.env.AI_MODEL || process.env.MIMO_MODEL || DEFAULT_MODEL).trim();
  const baseUrlValue = (process.env.AI_BASE_URL || process.env.MIMO_BASE_URL || DEFAULT_BASE_URL).trim();

  if (!apiKey) return { ok: false, error: "AI extraction is not configured on the server." };
  if (!model || model.length > 200) return { ok: false, error: "AI extraction model configuration is invalid." };

  try {
    const baseUrl = new URL(baseUrlValue);
    if (baseUrl.protocol !== "https:" && baseUrl.protocol !== "http:") {
      return { ok: false, error: "AI extraction endpoint configuration is invalid." };
    }
    baseUrl.search = "";
    baseUrl.hash = "";
    return {
      ok: true,
      apiKey,
      model,
      endpoint: `${baseUrl.toString().replace(/\/$/, "")}/chat/completions`,
    };
  } catch {
    return { ok: false, error: "AI extraction endpoint configuration is invalid." };
  }
}
