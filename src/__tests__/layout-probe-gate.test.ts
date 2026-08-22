import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { layoutProbeAccess } from "@/app/dev/layout-probe/layout-probe-gate";
import {
  AI_SETTINGS_ADMIN_COOKIE,
  createAiSettingsAdminToken,
} from "@/src/lib/ai-settings-admin-auth";

const ADMIN_SECRET = "layout-probe-gate-test-admin-secret";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("layout probe access gate", () => {
  it("stays available outside production without any flag", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(layoutProbeAccess(null)).toBe("available");
  });

  it("is denied in production unless explicitly enabled", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(layoutProbeAccess(null)).toBe("denied");
    vi.stubEnv("LAYOUT_PROBE_ENABLED", "false");
    expect(layoutProbeAccess(null)).toBe("denied");
  });

  it("requires the AI Settings admin session when enabled in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LAYOUT_PROBE_ENABLED", "true");
    vi.stubEnv("AI_SETTINGS_ADMIN_SECRET", ADMIN_SECRET);

    expect(layoutProbeAccess(null)).toBe("denied");
    expect(layoutProbeAccess(`${AI_SETTINGS_ADMIN_COOKIE}=v1.0.invalid`)).toBe("denied");

    const token = createAiSettingsAdminToken();
    expect(layoutProbeAccess(`${AI_SETTINGS_ADMIN_COOKIE}=${token}`)).toBe("available");
  });
});
