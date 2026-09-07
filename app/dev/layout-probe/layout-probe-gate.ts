import "server-only";

export type LayoutProbeAccess = "available" | "denied";

/**
 * Server-side access gate for the developer layout probe.
 * Non-production stays available. Production is denied unless explicitly
 * enabled; normal Auth.js and company membership checks are applied by the
 * page and route before any work is performed.
 */
export function layoutProbeAccess(cookieHeader: string | null): LayoutProbeAccess {
  void cookieHeader;
  if (process.env.NODE_ENV !== "production") return "available";
  return process.env.LAYOUT_PROBE_ENABLED === "true" ? "available" : "denied";
}
