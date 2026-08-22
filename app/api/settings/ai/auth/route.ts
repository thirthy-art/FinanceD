import { z } from "zod";
import {
  createAiSettingsAdminToken,
  serializeAiSettingsAdminCookie,
  verifyAiSettingsAdminSecret,
} from "@/src/lib/ai-settings-admin-auth";

export const runtime = "nodejs";

const AuthSchema = z.object({ secret: z.string().min(1).max(10_000) }).strict();

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Unauthorized." }, 401);
  }
  const parsed = AuthSchema.safeParse(body);
  if (!parsed.success) return json({ error: "Unauthorized." }, 401);

  const token = createAiSettingsAdminToken();
  if (!token) {
    return json({
      error: "AI settings admin access is not configured.",
      code: "AI_SETTINGS_ADMIN_NOT_CONFIGURED",
    }, 503);
  }
  if (!verifyAiSettingsAdminSecret(parsed.data.secret)) {
    return json({ error: "Unauthorized." }, 401);
  }

  const response = json({ ok: true });
  response.headers.append("Set-Cookie", serializeAiSettingsAdminCookie(token));
  return response;
}
