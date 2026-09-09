"use client";

import { useEffect, useState, type ReactNode } from "react";
import CompanyAccessState, { companyAccessCode, type CompanyAccessCode } from "@/src/components/CompanyAccessState";
import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Alert, LoadingState } from "@/src/components/ui/feedback";
import { Input } from "@/src/components/ui/input";
import { PageDescription, PageHeader, PageHeading, PageTitle } from "@/src/components/ui/page";
import { useI18n } from "@/src/i18n/context";

type ProviderState = { saving: boolean; testing: boolean; message: "saved" | "connected" | "error" | null };
const idleState: ProviderState = { saving: false, testing: false, message: null };

export default function AiSettingsPage() {
  const { t } = useI18n();
  const a = t.aiSettings;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [accessCode, setAccessCode] = useState<CompanyAccessCode | null>(null);
  const [mimoModel, setMimoModel] = useState("mimo-v2.5");
  const [mimoKey, setMimoKey] = useState("");
  const [mimoConfigured, setMimoConfigured] = useState(false);
  const [mimoState, setMimoState] = useState<ProviderState>(idleState);
  const [openrouterKey, setOpenrouterKey] = useState("");
  const [openrouterConfigured, setOpenrouterConfigured] = useState(false);
  const [fallback1, setFallback1] = useState("xiaomi/mimo-v2.5");
  const [fallback2, setFallback2] = useState("");
  const [openrouterState, setOpenrouterState] = useState<ProviderState>(idleState);

  useEffect(() => {
    fetch("/api/settings/ai", { cache: "no-store" })
      .then(async (response) => ({ response, data: await response.json().catch(() => null) }))
      .then(({ response, data }) => {
        const denied = companyAccessCode(data);
        if (denied) { setAccessCode(denied); return; }
        if (!response.ok || !data) throw new Error("load failed");
        setMimoModel(data.mimo.model);
        setMimoConfigured(data.mimo.configured);
        setOpenrouterConfigured(data.openRouter.configured);
        setFallback1(data.openRouter.fallback1Model);
        setFallback2(data.openRouter.fallback2Model);
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, []);

  async function save(provider: "mimo" | "openrouter") {
    const setState = provider === "mimo" ? setMimoState : setOpenrouterState;
    setState({ saving: true, testing: false, message: null });
    try {
      const response = await fetch("/api/settings/ai", {
        method: "PATCH", cache: "no-store", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(provider === "mimo"
          ? { provider, model: mimoModel, apiKey: mimoKey }
          : { provider, fallback1Model: fallback1, fallback2Model: fallback2, apiKey: openrouterKey }),
      });
      const data = await response.json().catch(() => ({}));
      const denied = companyAccessCode(data);
      if (denied) { setAccessCode(denied); setState(idleState); return; }
      if (!response.ok) throw new Error("save failed");
      setMimoConfigured(data.mimo.configured);
      setOpenrouterConfigured(data.openRouter.configured);
      if (provider === "mimo") setMimoKey(""); else setOpenrouterKey("");
      setState({ saving: false, testing: false, message: "saved" });
    } catch { setState({ saving: false, testing: false, message: "error" }); }
  }

  async function test(provider: "mimo" | "openrouter") {
    const setState = provider === "mimo" ? setMimoState : setOpenrouterState;
    setState({ saving: false, testing: true, message: null });
    try {
      const response = await fetch("/api/settings/ai/test", {
        method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, model: provider === "mimo" ? mimoModel : fallback1, apiKey: provider === "mimo" ? mimoKey : openrouterKey }),
      });
      const data = await response.json().catch(() => ({}));
      const denied = companyAccessCode(data);
      if (denied) { setAccessCode(denied); setState(idleState); return; }
      if (!response.ok) throw new Error("test failed");
      setState({ saving: false, testing: false, message: "connected" });
    } catch { setState({ saving: false, testing: false, message: "error" }); }
  }

  if (loading) return <LoadingState>{a.loading}</LoadingState>;
  if (accessCode) return <CompanyAccessState code={accessCode} />;
  if (loadError) return <Alert tone="error">{a.loadError}</Alert>;

  const status = (state: ProviderState) => state.message === "saved" ? a.saved : state.message === "connected" ? a.connected : state.message === "error" ? a.actionError : null;

  return (
    <div className="max-w-3xl">
      <PageHeader><PageHeading><PageTitle>{a.title}</PageTitle><PageDescription>{a.description}</PageDescription></PageHeading></PageHeader>
      <div className="grid gap-4">
        <ProviderCard title={a.mimoTitle} configured={mimoConfigured} configuredLabel={a.configured}>
          <Field label={a.model}><Input value={mimoModel} onChange={(event) => setMimoModel(event.target.value)} /></Field>
          <Field label={a.apiKey}><Input type="password" autoComplete="new-password" spellCheck={false} value={mimoKey} placeholder={mimoConfigured ? a.configured : ""} onChange={(event) => setMimoKey(event.target.value)} /></Field>
          <ProviderActions state={mimoState} saveLabel={a.save} savingLabel={a.saving} testLabel={a.testConnection} testingLabel={a.testing} onSave={() => save("mimo")} onTest={() => test("mimo")} message={status(mimoState)} />
        </ProviderCard>
        <ProviderCard title={a.openrouterTitle} configured={openrouterConfigured} configuredLabel={a.configured}>
          <Field label={a.apiKey}><Input type="password" autoComplete="new-password" spellCheck={false} value={openrouterKey} placeholder={openrouterConfigured ? a.configured : ""} onChange={(event) => setOpenrouterKey(event.target.value)} /></Field>
          <Field label={a.fallback1}><Input value={fallback1} onChange={(event) => setFallback1(event.target.value)} /></Field>
          <Field label={a.fallback2}><Input value={fallback2} placeholder={a.optional} onChange={(event) => setFallback2(event.target.value)} /></Field>
          <ProviderActions state={openrouterState} saveLabel={a.save} savingLabel={a.saving} testLabel={a.testConnection} testingLabel={a.testing} onSave={() => save("openrouter")} onTest={() => test("openrouter")} message={status(openrouterState)} />
        </ProviderCard>
      </div>
    </div>
  );
}

function ProviderCard({ title, configured, configuredLabel, children }: { title: string; configured: boolean; configuredLabel: string; children: ReactNode }) {
  return <Card><CardHeader className="flex-row items-center justify-between"><CardTitle>{title}</CardTitle>{configured && <Badge variant="success">{configuredLabel}</Badge>}</CardHeader><CardContent className="grid gap-4">{children}</CardContent></Card>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block"><span className="ui-label">{label}</span>{children}</label>;
}

function ProviderActions({ state, saveLabel, savingLabel, testLabel, testingLabel, onSave, onTest, message }: { state: ProviderState; saveLabel: string; savingLabel: string; testLabel: string; testingLabel: string; onSave: () => void; onTest: () => void; message: string | null }) {
  const disabled = state.saving || state.testing;
  return <div className="flex flex-wrap items-center gap-2 pt-1"><Button type="button" disabled={disabled} onClick={onSave}>{state.saving ? savingLabel : saveLabel}</Button><Button type="button" variant="secondary" disabled={disabled} onClick={onTest}>{state.testing ? testingLabel : testLabel}</Button>{message && <Alert tone={state.message === "error" ? "error" : "success"} className="py-2" role="status">{message}</Alert>}</div>;
}
