import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { POST } from "@/app/api/settings/ai/auth/route";
import {
  AI_SETTINGS_ADMIN_COOKIE,
  AI_SETTINGS_ADMIN_COOKIE_MAX_AGE_SECONDS,
  createAiSettingsAdminToken,
  getAiSettingsAdminAccess,
  serializeAiSettingsAdminCookie,
  verifyAiSettingsAdminToken,
} from "@/src/lib/ai-settings-admin-auth";

const originalSecret = process.env.AI_SETTINGS_ADMIN_SECRET;

function request(secret: string) {
  return new Request("http://localhost/api/settings/ai/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret }),
  });
}

beforeEach(() => {
  process.env.AI_SETTINGS_ADMIN_SECRET = "correct-high-entropy-admin-secret";
});

afterAll(() => {
  if (originalSecret === undefined) delete process.env.AI_SETTINGS_ADMIN_SECRET;
  else process.env.AI_SETTINGS_ADMIN_SECRET = originalSecret;
});

describe("AI settings admin authorization", () => {
  it("rejects a wrong secret generically without issuing or echoing it", async () => {
    const sentinel = "WRONG-SECRET-MUST-NOT-LEAK";
    const response = await POST(request(sentinel));
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(JSON.stringify(await response.json())).not.toContain(sentinel);
  });

  it("issues a one-hour signed HttpOnly strict cookie for the correct secret", async () => {
    const secret = process.env.AI_SETTINGS_ADMIN_SECRET!;
    const response = await POST(request(secret));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toContain(`${AI_SETTINGS_ADMIN_COOKIE}=`);
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain(`Max-Age=${AI_SETTINGS_ADMIN_COOKIE_MAX_AGE_SECONDS}`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).not.toContain(secret);

    const cookiePair = cookie.split(";", 1)[0];
    expect(getAiSettingsAdminAccess(cookiePair)).toBe("authorized");
  });

  it("uses Secure in production and rejects expired signed tokens", () => {
    const issuedAt = 1_700_000_000_000;
    const token = createAiSettingsAdminToken(issuedAt)!;
    expect(serializeAiSettingsAdminCookie(token, true)).toContain("; Secure");
    expect(verifyAiSettingsAdminToken(token, issuedAt + 30 * 60 * 1000)).toBe(true);
    expect(verifyAiSettingsAdminToken(token, issuedAt + 61 * 60 * 1000)).toBe(false);
  });

  it("fails closed when the deployment admin secret is absent", async () => {
    delete process.env.AI_SETTINGS_ADMIN_SECRET;
    const response = await POST(request("anything"));
    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(getAiSettingsAdminAccess(null)).toBe("not-configured");
  });
});
