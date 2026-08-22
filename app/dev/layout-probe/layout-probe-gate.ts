import "server-only";

import { getAiSettingsAdminAccess } from "@/src/lib/ai-settings-admin-auth";

export type LayoutProbeAccess = "available" | "denied";

/**
 * Server-side access gate for the developer layout probe.
 * Non-production stays available. Production is denied unless
 * LAYOUT_PROBE_ENABLED=true AND the request carries a valid AI Settings
 * admin session.
 */
export function layoutProbeAccess(cookieHeader: string | null): LayoutProbeAccess {
  if (process.env.NODE_ENV !== "production") return "available";
  if (process.env.LAYOUT_PROBE_ENABLED !== "true") return "denied";
  return getAiSettingsAdminAccess(cookieHeader) === "authorized" ? "available" : "denied";
}
