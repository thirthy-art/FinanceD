"use client";

import Link from "next/link";
import { useI18n } from "@/src/i18n/context";

export type CompanyAccessCode =
  | "AUTHENTICATION_REQUIRED"
  | "NO_COMPANY_ASSIGNED"
  | "ACTIVE_COMPANY_REQUIRED";

export function companyAccessCode(value: unknown): CompanyAccessCode | null {
  if (!value || typeof value !== "object" || !("code" in value)) return null;
  const code = value.code;
  return code === "AUTHENTICATION_REQUIRED"
    || code === "NO_COMPANY_ASSIGNED"
    || code === "ACTIVE_COMPANY_REQUIRED"
    ? code
    : null;
}

export default function CompanyAccessState({ code }: { code: CompanyAccessCode }) {
  const { t } = useI18n();
  return (
    <div role="status" className="company-selection-required">
      {code === "AUTHENTICATION_REQUIRED"
        ? <Link href="/sign-in" className="ui-table-link">{t.auth.signInTitle}</Link>
        : t.companySwitcher.selectAbove}
    </div>
  );
}
