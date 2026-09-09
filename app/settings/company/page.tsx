"use client";
import { useEffect, useState } from "react";
import { useI18n } from "@/src/i18n/context";
import CompanyAccessState, { companyAccessCode, type CompanyAccessCode } from "@/src/components/CompanyAccessState";
import { SUPPORTED_BASE_CURRENCIES } from "@/src/lib/supported-base-currencies";
import { Button } from "@/src/components/ui/button";
import { Card } from "@/src/components/ui/card";
import { Input } from "@/src/components/ui/input";
import { PageHeader, PageTitle } from "@/src/components/ui/page";
import { Select } from "@/src/components/ui/select";
import { Alert, LoadingState } from "@/src/components/ui/feedback";

export default function CompanyPage() {
  const { t } = useI18n();
  const c = t.company;

  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [accessCode, setAccessCode] = useState<CompanyAccessCode | null>(null);

  useEffect(() => {
    fetch("/api/settings/company")
      .then(async (response) => ({ response, data: await response.json().catch(() => ({})) }))
      .then(({ response, data }) => {
        const denied = companyAccessCode(data);
        if (denied) { setAccessCode(denied); return; }
        if (!response.ok || typeof data.name !== "string" || typeof data.baseCurrency !== "string") throw new Error("load failed");
        setName(data.name);
        setCurrency(data.baseCurrency);
      })
      .catch(() => setError(c.couldNotSave))
      .finally(() => setLoading(false));
  }, [c.couldNotSave]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError(""); setSaved(false);
    try {
      const res = await fetch("/api/settings/company", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, baseCurrency: currency }),
      });
      const data = await res.json().catch(() => ({}));
      const denied = companyAccessCode(data);
      if (denied) { setAccessCode(denied); return; }
      if (!res.ok) throw new Error("Save failed");
      setSaved(true);
    } catch { setError(c.couldNotSave); }
    finally { setSaving(false); }
  }

  if (loading) return <LoadingState>{c.loading}</LoadingState>;
  if (accessCode) return <CompanyAccessState code={accessCode} />;

  return (
    <div className="max-w-lg">
      <PageHeader><PageTitle>{c.title}</PageTitle></PageHeader>
      <Card className="p-5 sm:p-6">
        <form onSubmit={save}>
          <div className="mb-4">
            <label className="ui-label" htmlFor="company-name">{c.nameLabel}</label>
            <Input id="company-name" value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} required />
          </div>
          <div className="mb-6">
            <label className="ui-label" htmlFor="company-currency">{c.currencyLabel}</label>
            <Select id="company-currency" value={currency} onChange={(e) => { setCurrency(e.target.value); setSaved(false); }}>
              {SUPPORTED_BASE_CURRENCIES.map((cur) => <option key={cur}>{cur}</option>)}
            </Select>
          </div>
          {error && <Alert tone="error" className="mb-3">{error}</Alert>}
          {saved && <Alert tone="success" className="mb-3">{c.saved}</Alert>}
          <Button type="submit" disabled={saving}>
            {saving ? c.saving : c.save}
          </Button>
        </form>
      </Card>
    </div>
  );
}
