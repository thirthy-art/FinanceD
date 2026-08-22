import { z } from "zod";
import {
  getPublicAiSettings,
  saveMimoSettings,
  saveOpenRouterSettings,
} from "@/src/lib/ai-settings";

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

export async function GET() {
  try {
    return json(await getPublicAiSettings());
  } catch {
    return json({ error: "AI settings are temporarily unavailable." }, 503);
  }
}

export async function PATCH(request: Request) {
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
