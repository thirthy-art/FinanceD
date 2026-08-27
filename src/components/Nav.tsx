"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import CompanySwitcher from "@/src/components/CompanySwitcher";
import { useI18n } from "@/src/i18n/context";
import type { Locale } from "@/src/i18n/types";
import { SUPPORTED_LOCALES } from "@/src/i18n/types";

const LOCALE_LABELS: Record<Locale, string> = { en: "EN", ru: "RU", he: "HE" };

type OpenMenu = "language" | "navigation" | null;

export default function Nav() {
  const pathname = usePathname();
  const { t, locale, setLocale } = useI18n();
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
  const actionsRef = useRef<HTMLDivElement>(null);

  const primaryLinks = [
    { href: "/", label: t.nav.invoices },
    { href: "/cash-flow", label: t.nav.cashForecast },
  ];
  const menuLinks = [
    ...primaryLinks.map((link) => ({ ...link, mobileOnly: true })),
    { href: "/reconciliation", label: t.nav.reconciliation, mobileOnly: false },
    { href: "/budget", label: t.nav.budget, mobileOnly: false },
    { href: "/settings/vendors", label: t.nav.vendors, mobileOnly: false },
    { href: "/settings/chart-of-accounts", label: t.nav.chartOfAccounts, mobileOnly: false },
    { href: "/settings/company", label: t.nav.company, mobileOnly: false },
    { href: "/settings/ai", label: t.nav.aiSettings, mobileOnly: false },
  ];

  function isActive(href: string) {
    return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
  }

  function toggleMenu(menu: Exclude<OpenMenu, null>) {
    setOpenMenu((current) => current === menu ? null : menu);
  }

  useEffect(() => {
    if (!openMenu) return;

    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !actionsRef.current?.contains(event.target)) {
        setOpenMenu(null);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenMenu(null);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openMenu]);

  return (
    <nav className="app-nav">
      <div className="app-nav-inner">
        <Link href="/" className="app-nav-brand">FinanceD</Link>
        <CompanySwitcher />

        <div className="app-nav-primary">
          {primaryLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`app-nav-link${isActive(link.href) ? " app-nav-link-active" : ""}`}
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="app-nav-actions" ref={actionsRef}>
          <div className="app-nav-dropdown">
            <button
              type="button"
              className="app-nav-control app-nav-language-control"
              aria-label={t.nav.language}
              aria-expanded={openMenu === "language"}
              aria-haspopup="menu"
              onClick={() => toggleMenu("language")}
            >
              <span>{LOCALE_LABELS[locale]}</span>
              <span aria-hidden="true">▾</span>
            </button>
            {openMenu === "language" && (
              <div className="app-nav-menu app-nav-language-menu" role="menu" dir="ltr">
                {SUPPORTED_LOCALES.map((supportedLocale) => (
                  <button
                    key={supportedLocale}
                    type="button"
                    role="menuitem"
                    className={`app-nav-menu-item${locale === supportedLocale ? " app-nav-menu-item-active" : ""}`}
                    onClick={() => {
                      setLocale(supportedLocale);
                      setOpenMenu(null);
                    }}
                  >
                    {LOCALE_LABELS[supportedLocale]}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="app-nav-dropdown">
            <button
              type="button"
              className="app-nav-control app-nav-menu-control"
              aria-label={t.nav.menu}
              aria-expanded={openMenu === "navigation"}
              aria-haspopup="menu"
              onClick={() => toggleMenu("navigation")}
            >
              <span aria-hidden="true">☰</span>
            </button>
            {openMenu === "navigation" && (
              <div className="app-nav-menu app-nav-navigation-menu" role="menu">
                {menuLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    role="menuitem"
                    className={`app-nav-menu-item${link.mobileOnly ? " app-nav-menu-item-mobile-only" : ""}${isActive(link.href) ? " app-nav-menu-item-active" : ""}`}
                    onClick={() => setOpenMenu(null)}
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
