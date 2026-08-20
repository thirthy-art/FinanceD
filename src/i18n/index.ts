import type { Locale, Messages } from "./types";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "./types";
import { en } from "./en";
import { ru } from "./ru";
import { he } from "./he";

export { DEFAULT_LOCALE, SUPPORTED_LOCALES, LOCALE_COOKIE } from "./types";
export type { Locale, Messages };

export function resolveLocale(raw: string | undefined | null): Locale {
  if (raw && (SUPPORTED_LOCALES as string[]).includes(raw)) {
    return raw as Locale;
  }
  return DEFAULT_LOCALE;
}

export function getDir(locale: Locale): "ltr" | "rtl" {
  return locale === "he" ? "rtl" : "ltr";
}

const MESSAGES: Record<Locale, Messages> = { en, ru, he };

export function getMessages(locale: Locale): Messages {
  return MESSAGES[locale];
}
