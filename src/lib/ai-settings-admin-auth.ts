import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const AI_SETTINGS_ADMIN_COOKIE = "financed_ai_settings_admin";
export const AI_SETTINGS_ADMIN_COOKIE_MAX_AGE_SECONDS = 60 * 60;

export type AiSettingsAdminAccess = "authorized" | "unauthorized" | "not-configured";

function configuredAdminSecret(): string | null {
  const secret = process.env.AI_SETTINGS_ADMIN_SECRET;
  return secret ? secret : null;
}

function digestSecret(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

export function verifyAiSettingsAdminSecret(submittedSecret: string): boolean {
  const expectedSecret = configuredAdminSecret();
  if (!expectedSecret) return false;
  return timingSafeEqual(digestSecret(submittedSecret), digestSecret(expectedSecret));
}

function tokenSignature(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret)
    .update("FinanceD AI settings admin session\0", "utf8")
    .update(payload, "utf8")
    .digest();
}

export function createAiSettingsAdminToken(nowMs = Date.now()): string | null {
  const secret = configuredAdminSecret();
  if (!secret) return null;
  const expiresAt = Math.floor(nowMs / 1000) + AI_SETTINGS_ADMIN_COOKIE_MAX_AGE_SECONDS;
  const payload = `v1.${expiresAt}`;
  return `${payload}.${tokenSignature(payload, secret).toString("base64url")}`;
}

export function verifyAiSettingsAdminToken(token: string, nowMs = Date.now()): boolean {
  const secret = configuredAdminSecret();
  if (!secret) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1" || !/^\d+$/.test(parts[1])) return false;

  const now = Math.floor(nowMs / 1000);
  const expiresAt = Number(parts[1]);
  if (
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= now ||
    expiresAt > now + AI_SETTINGS_ADMIN_COOKIE_MAX_AGE_SECONDS
  ) return false;

  const payload = `${parts[0]}.${parts[1]}`;
  const expected = tokenSignature(payload, secret);
  let submitted: Buffer;
  try {
    submitted = Buffer.from(parts[2], "base64url");
  } catch {
    return false;
  }
  return submitted.length === expected.length && timingSafeEqual(submitted, expected);
}

function cookieValue(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const item of cookieHeader.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() === AI_SETTINGS_ADMIN_COOKIE) {
      return item.slice(separator + 1).trim();
    }
  }
  return null;
}

export function getAiSettingsAdminAccess(cookieHeader: string | null): AiSettingsAdminAccess {
  if (!configuredAdminSecret()) return "not-configured";
  const token = cookieValue(cookieHeader);
  return token && verifyAiSettingsAdminToken(token) ? "authorized" : "unauthorized";
}

export function serializeAiSettingsAdminCookie(
  token: string,
  production = process.env.NODE_ENV === "production",
): string {
  return [
    `${AI_SETTINGS_ADMIN_COOKIE}=${token}`,
    "Path=/",
    `Max-Age=${AI_SETTINGS_ADMIN_COOKIE_MAX_AGE_SECONDS}`,
    "HttpOnly",
    "SameSite=Strict",
    production ? "Secure" : null,
  ].filter(Boolean).join("; ");
}
