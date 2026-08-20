import { describe, expect, it } from "vitest";
import { resolveLocale, getDir, getMessages } from "@/src/i18n/index";
import { en } from "@/src/i18n/en";
import { ru } from "@/src/i18n/ru";
import { he } from "@/src/i18n/he";

// ── resolveLocale ─────────────────────────────────────────────────────────────

describe("resolveLocale", () => {
  it("returns 'en' for undefined", () => {
    expect(resolveLocale(undefined)).toBe("en");
  });

  it("returns 'en' for null", () => {
    expect(resolveLocale(null)).toBe("en");
  });

  it("returns 'en' for an empty string", () => {
    expect(resolveLocale("")).toBe("en");
  });

  it("returns 'en' for an unrecognised value", () => {
    expect(resolveLocale("fr")).toBe("en");
    expect(resolveLocale("EN")).toBe("en");
    expect(resolveLocale("english")).toBe("en");
  });

  it("returns 'en' for the value 'en'", () => {
    expect(resolveLocale("en")).toBe("en");
  });

  it("returns 'ru' for the value 'ru'", () => {
    expect(resolveLocale("ru")).toBe("ru");
  });

  it("returns 'he' for the value 'he'", () => {
    expect(resolveLocale("he")).toBe("he");
  });
});

// ── getDir ────────────────────────────────────────────────────────────────────

describe("getDir", () => {
  it("returns 'ltr' for English", () => {
    expect(getDir("en")).toBe("ltr");
  });

  it("returns 'ltr' for Russian", () => {
    expect(getDir("ru")).toBe("ltr");
  });

  it("returns 'rtl' for Hebrew", () => {
    expect(getDir("he")).toBe("rtl");
  });
});

// ── dictionary structure ──────────────────────────────────────────────────────

function collectKeys(obj: object, prefix = ""): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object") {
      keys.push(...collectKeys(v as object, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

describe("dictionary structure", () => {
  const enKeys = collectKeys(en).sort();
  const ruKeys = collectKeys(ru).sort();
  const heKeys = collectKeys(he).sort();

  it("Russian has the same keys as English", () => {
    expect(ruKeys).toEqual(enKeys);
  });

  it("Hebrew has the same keys as English", () => {
    expect(heKeys).toEqual(enKeys);
  });

  it("all three dictionaries have more than 50 keys (sanity check)", () => {
    expect(enKeys.length).toBeGreaterThan(50);
  });
});

// ── non-English content ───────────────────────────────────────────────────────

describe("non-English message content", () => {
  it("Russian nav.invoices differs from English", () => {
    const enMsg = getMessages("en");
    const ruMsg = getMessages("ru");
    expect(ruMsg.nav.invoices).not.toBe(enMsg.nav.invoices);
  });

  it("Hebrew nav.invoices contains Hebrew script characters", () => {
    const heMsg = getMessages("he");
    expect(/[֐-׿]/.test(heMsg.nav.invoices)).toBe(true);
  });

  it("Hebrew common.del contains Hebrew script characters", () => {
    const heMsg = getMessages("he");
    expect(/[֐-׿]/.test(heMsg.common.del)).toBe(true);
  });
});
