"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/src/i18n/context";
import type { Locale } from "@/src/i18n/types";
import { SUPPORTED_LOCALES } from "@/src/i18n/types";

const LOCALE_LABELS: Record<Locale, string> = { en: "EN", ru: "RU", he: "HE" };

export default function Nav() {
  const pathname = usePathname();
  const { t, locale, setLocale } = useI18n();

  const links = [
    { href: "/", label: t.nav.invoices },
    { href: "/invoices/new", label: t.nav.newInvoice },
    { href: "/cash-flow", label: t.nav.cashForecast },
    { href: "/budget", label: t.nav.budget },
    { href: "/settings/chart-of-accounts", label: t.nav.chartOfAccounts },
    { href: "/settings/vendors", label: t.nav.vendors },
    { href: "/settings/company", label: t.nav.company },
  ];

  return (
    <nav style={{ background: "#1e3a5f", color: "#fff" }}>
      <div
        className="max-w-7xl mx-auto px-4 flex items-center gap-1"
        style={{ height: 52 }}
      >
        <Link
          href="/"
          style={{ fontWeight: 700, fontSize: 18, marginInlineEnd: 24, color: "#fff", textDecoration: "none" }}
        >
          FinanceD
        </Link>
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            style={{
              padding: "6px 12px",
              borderRadius: 6,
              color: pathname === l.href ? "#fff" : "#cbd5e1",
              background: pathname === l.href ? "rgba(255,255,255,0.15)" : "transparent",
              textDecoration: "none",
              fontSize: 13,
              fontWeight: pathname === l.href ? 600 : 400,
            }}
          >
            {l.label}
          </Link>
        ))}
        <div style={{ marginInlineStart: "auto", display: "flex", gap: 4 }} dir="ltr">
          {SUPPORTED_LOCALES.map((loc) => (
            <button
              key={loc}
              onClick={() => setLocale(loc)}
              style={{
                padding: "4px 8px",
                borderRadius: 4,
                border: "none",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: locale === loc ? 700 : 400,
                background: locale === loc ? "rgba(255,255,255,0.25)" : "transparent",
                color: locale === loc ? "#fff" : "#94a3b8",
              }}
            >
              {LOCALE_LABELS[loc]}
            </button>
          ))}
        </div>
      </div>
    </nav>
  );
}
