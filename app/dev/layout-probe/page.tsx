import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import LayoutProbeTool from "./LayoutProbeTool";
import { layoutProbeAccess } from "./layout-probe-gate";
import { getActiveCompanyForPage } from "@/src/lib/active-company-page";
import CompanySelectionRequired from "@/src/components/CompanySelectionRequired";
import { cookies } from "next/headers";
import { LOCALE_COOKIE } from "@/src/i18n/types";
import { resolveLocale } from "@/src/i18n";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Layout Probe (dev)",
  description: "Developer-only deterministic PDF layout evidence inspector",
};

export default async function LayoutProbePage() {
  const cookieHeader = (await headers()).get("cookie");
  if (layoutProbeAccess(cookieHeader) !== "available") notFound();
  const company = await getActiveCompanyForPage();
  if (!company) {
    const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
    return <CompanySelectionRequired locale={locale} />;
  }
  return <LayoutProbeTool />;
}
