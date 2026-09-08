"use client";
import { useEffect, useState } from "react";
import { useI18n } from "@/src/i18n/context";
import { SUPPORTED_BASE_CURRENCIES } from "@/src/lib/supported-base-currencies";
import { Button } from "@/src/components/ui/button";
import { Card } from "@/src/components/ui/card";
import { Input } from "@/src/components/ui/input";
import { PageHeader, PageTitle } from "@/src/components/ui/page";
import { Select } from "@/src/components/ui/select";

export default function CompanyPage() {
  const { t } = useI18n();
  const c = t.company;

  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/settings/company")
      .then((r) => r.json())
      .then((d) => { setName(d.name); setCurrency(d.baseCurrency); setLoading(false); });
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError(""); setSaved(false);
    try {
      const res = await fetch("/api/settings/company", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, baseCurrency: currency }),
      });
      if (!res.ok) throw new Error("Save failed");
      setSaved(true);
    } catch { setError(c.couldNotSave); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="text-sm text-[var(--muted-foreground)]" role="status">{c.loading}</div>;

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
          {error && <div className="ui-alert ui-alert-error mb-3" role="alert">{error}</div>}
          {saved && <div className="ui-alert ui-alert-success mb-3" role="status">{c.saved}</div>}
          <Button type="submit" disabled={saving}>
            {saving ? c.saving : c.save}
          </Button>
        </form>
      </Card>
    </div>
  );
}
