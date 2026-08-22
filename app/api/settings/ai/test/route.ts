import { z } from "zod";
import { getAiTestCandidate } from "@/src/lib/ai-provider";
import { testAiProviderConnection } from "@/src/lib/ai-provider-chain";
import { getAiSettingsAdminAccess } from "@/src/lib/ai-settings-admin-auth";

export const runtime = "nodejs";

const modelSlug = z.string().trim().min(1).max(200).refine(
  (value) => !/[\u0000-\u001f\u007f]/.test(value),
  "Invalid model slug.",
);

const TestSchema = z.object({
  provider: z.enum(["mimo", "openrouter"]),
  model: modelSlug,
  apiKey: z.string().trim().max(10_000).optional().transform((value) => value || undefined),
}).strict();

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const access = getAiSettingsAdminAccess(request.headers.get("cookie"));
  if (access === "not-configured") {
    return json({
      error: "AI settings admin access is not configured.",
      code: "AI_SETTINGS_ADMIN_NOT_CONFIGURED",
    }, 503);
  }
  if (access !== "authorized") return json({ error: "Unauthorized." }, 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid connection test request." }, 400);
  }
  const parsed = TestSchema.safeParse(body);
  if (!parsed.success) return json({ error: "Invalid connection test request." }, 400);

  try {
    const candidate = await getAiTestCandidate(parsed.data);
    if (!candidate || candidate.configurationError) {
      return json({ error: "This AI provider is not configured." }, 503);
    }
    const result = await testAiProviderConnection(candidate);
    if (!result.ok) return json({ error: "The AI provider connection test failed." }, 502);
    return json({ ok: true, providerMetadata: result.metadata });
  } catch {
    return json({ error: "The AI provider connection test failed." }, 502);
  }
}
