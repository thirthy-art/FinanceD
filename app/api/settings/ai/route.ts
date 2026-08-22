import { z } from "zod";
import {
  getPublicAiSettings,
  saveMimoSettings,
  saveOpenRouterSettings,
} from "@/src/lib/ai-settings";
import { getAiSettingsAdminAccess } from "@/src/lib/ai-settings-admin-auth";

export const runtime = "nodejs";

const modelSlug = z.string().trim().min(1).max(200).refine(
  (value) => !/[\u0000-\u001f\u007f]/.test(value),
  "Invalid model slug.",
);
const optionalKey = z.string().trim().max(10_000).optional().transform((value) => value || undefined);

const UpdateSchema = z.discriminatedUnion("provider", [
  z.object({ provider: z.literal("mimo"), model: modelSlug, apiKey: optionalKey }).strict(),
  z.object({
    provider: z.literal("openrouter"),
    fallback1Model: modelSlug,
    fallback2Model: z.string().trim().max(200).refine(
      (value) => !/[\u0000-\u001f\u007f]/.test(value),
      "Invalid model slug.",
    ),
    apiKey: optionalKey,
  }).strict(),
]);

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function requireAdmin(request: Request): Response | null {
  const access = getAiSettingsAdminAccess(request.headers.get("cookie"));
  if (access === "authorized") return null;
  if (access === "not-configured") {
    return json({
      error: "AI settings admin access is not configured.",
      code: "AI_SETTINGS_ADMIN_NOT_CONFIGURED",
    }, 503);
  }
  return json({ error: "Unauthorized." }, 401);
}

export async function GET(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    return json(await getPublicAiSettings());
  } catch {
    return json({ error: "AI settings are temporarily unavailable." }, 503);
  }
}

export async function PATCH(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid AI settings request." }, 400);
  }
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) return json({ error: "Invalid AI settings request." }, 400);

  try {
    if (parsed.data.provider === "mimo") {
      await saveMimoSettings({ model: parsed.data.model, apiKey: parsed.data.apiKey });
    } else {
      await saveOpenRouterSettings({
        fallback1Model: parsed.data.fallback1Model,
        fallback2Model: parsed.data.fallback2Model || null,
        apiKey: parsed.data.apiKey,
      });
    }
    return json(await getPublicAiSettings());
  } catch {
    return json({ error: "AI settings could not be saved." }, 503);
  }
}
