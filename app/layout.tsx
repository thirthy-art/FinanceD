import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import Nav from "@/src/components/Nav";
import { I18nProvider } from "@/src/i18n/context";
import { resolveLocale, getDir } from "@/src/i18n/index";
import { LOCALE_COOKIE } from "@/src/i18n/types";

export const metadata: Metadata = {
  title: "FinanceD",
  description: "Supplier invoice management",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const locale = resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value);
  const dir = getDir(locale);

  return (
    <html lang={locale} dir={dir}>
      <body>
        <I18nProvider initialLocale={locale}>
          <Nav />
          <main className="max-w-7xl mx-auto px-4 py-6">{children}</main>
        </I18nProvider>
      </body>
    </html>
  );
}
