import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { layoutProbeAccess } from "@/app/dev/layout-probe/layout-probe-gate";

afterEach(() => vi.unstubAllEnvs());

describe("layout probe availability gate", () => {
  it("is available outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(layoutProbeAccess(null)).toBe("available");
  });

  it("is denied by default in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(layoutProbeAccess(null)).toBe("denied");
  });

  it("can be enabled in production before the separate membership boundary runs", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LAYOUT_PROBE_ENABLED", "true");
    expect(layoutProbeAccess(null)).toBe("available");
  });
});
