"use client";

import { useEffect, useRef, useState, type ComponentType, type RefObject } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  Bot, Building2, ChartNoAxesColumnIncreasing, ChevronsUpDown, FileText,
  Languages, Landmark, LogOut, Menu, Scale, SlidersHorizontal, Users, WalletCards, X,
} from "lucide-react";
import CompanySwitcher from "@/src/components/CompanySwitcher";
import { useI18n } from "@/src/i18n/context";
import type { Locale } from "@/src/i18n/types";
import { SUPPORTED_LOCALES } from "@/src/i18n/types";

const LOCALE_LABELS: Record<Locale, string> = { en: "EN", ru: "RU", he: "HE" };
type NavLink = { href: string; label: string; icon: ComponentType<{ size?: number; strokeWidth?: number; "aria-hidden"?: boolean | "true" }> };

export default function Nav({ user }: { user?: { name?: string | null; email?: string | null } | null }) {
  const pathname = usePathname();
  const { t, locale, setLocale } = useI18n();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const languageRef = useRef<HTMLDivElement>(null);

  const links: NavLink[] = [
    { href: "/", label: t.nav.invoices, icon: FileText },
    { href: "/cash-flow", label: t.nav.cashForecast, icon: ChartNoAxesColumnIncreasing },
    { href: "/reconciliation", label: t.nav.reconciliation, icon: Scale },
    { href: "/reconciliation/payment-accounts", label: t.paymentAccounts.topPayments, icon: WalletCards },
    { href: "/budget", label: t.nav.budget, icon: Landmark },
    { href: "/settings/vendors", label: t.nav.vendors, icon: Users },
    { href: "/settings/chart-of-accounts", label: t.nav.chartOfAccounts, icon: SlidersHorizontal },
    { href: "/settings/company", label: t.nav.company, icon: Building2 },
    { href: "/settings/ai", label: t.nav.aiSettings, icon: Bot },
  ];

  function isActive(href: string) {
    if (href === "/") return pathname === "/" || pathname.startsWith("/invoices/");
    if (href === "/reconciliation") return pathname === href;
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  useEffect(() => {
    if (!languageOpen) return;
    function close(event: PointerEvent) {
      if (event.target instanceof Node && !languageRef.current?.contains(event.target)) setLanguageOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") setLanguageOpen(false);
    }
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [languageOpen]);

  useEffect(() => {
    if (!mobileOpen) return;
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") setMobileOpen(false);
    }
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [mobileOpen]);

  if (!user) {
    return (
      <header className="auth-topbar">
        <Link href="/" className="app-brand" aria-label="FinanceD"><BrandMark /><span>FinanceD</span></Link>
        <LanguageControl locale={locale} label={t.nav.language} open={languageOpen} setOpen={setLanguageOpen} setLocale={setLocale} controlRef={languageRef} />
      </header>
    );
  }

  const identity = user.email ?? user.name ?? "";
  return (
    <>
      <header className="mobile-topbar">
        <Link href="/" className="app-brand" aria-label="FinanceD"><BrandMark /><span>FinanceD</span></Link>
        <button type="button" className="mobile-menu-button" aria-label={t.nav.menu} aria-expanded={mobileOpen} aria-controls="app-sidebar" onClick={() => setMobileOpen((open) => !open)}>
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </header>
      {mobileOpen && <button type="button" className="app-sidebar-backdrop" aria-label={t.nav.menu} onClick={() => setMobileOpen(false)} />}
      <aside id="app-sidebar" className={`app-sidebar${mobileOpen ? " app-sidebar-open" : ""}`}>
        <div className="app-sidebar-header">
          <Link href="/" className="app-brand" aria-label="FinanceD"><BrandMark /><span>FinanceD</span></Link>
        </div>
        <div className="app-sidebar-company"><CompanySwitcher /></div>
        <nav className="app-sidebar-nav" aria-label={t.nav.menu}>
          {links.map((link) => {
            const Icon = link.icon;
            const active = isActive(link.href);
            return (
              <Link key={link.href} href={link.href} className={`app-sidebar-link${active ? " app-sidebar-link-active" : ""}`} aria-current={active ? "page" : undefined} onClick={() => setMobileOpen(false)}>
                <Icon size={18} strokeWidth={1.8} aria-hidden="true" /><span>{link.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="app-sidebar-footer">
          <LanguageControl locale={locale} label={t.nav.language} open={languageOpen} setOpen={setLanguageOpen} setLocale={setLocale} controlRef={languageRef} />
          <div className="app-account">
            <div className="app-account-avatar" aria-hidden="true">{identity.slice(0, 1).toUpperCase()}</div>
            <div className="app-account-copy"><span className="app-account-label">{t.auth.signedInAs}</span><span className="app-account-name" title={identity}>{identity}</span></div>
            <button type="button" className="app-account-signout" title={t.auth.signOut} aria-label={t.auth.signOut} onClick={() => void signOut({ redirectTo: "/sign-in" })}><LogOut size={17} aria-hidden="true" /></button>
          </div>
        </div>
      </aside>
    </>
  );
}

function BrandMark() { return <span className="app-brand-mark" aria-hidden="true"><Landmark size={17} strokeWidth={2.2} /></span>; }

function LanguageControl({ locale, label, open, setOpen, setLocale, controlRef }: { locale: Locale; label: string; open: boolean; setOpen: (open: boolean) => void; setLocale: (locale: Locale) => void; controlRef: RefObject<HTMLDivElement | null> }) {
  return (
    <div className="language-control" ref={controlRef}>
      <button type="button" className="language-control-button" aria-label={label} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)}>
        <Languages size={17} aria-hidden="true" /><span>{LOCALE_LABELS[locale]}</span><ChevronsUpDown size={14} aria-hidden="true" />
      </button>
      {open && <div className="language-menu" role="menu" dir="ltr">
        {SUPPORTED_LOCALES.map((supportedLocale) => <button key={supportedLocale} type="button" role="menuitem" className={`language-menu-item${locale === supportedLocale ? " language-menu-item-active" : ""}`} onClick={() => { setLocale(supportedLocale); setOpen(false); }}>{LOCALE_LABELS[supportedLocale]}</button>)}
      </div>}
    </div>
  );
}
