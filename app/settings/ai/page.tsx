"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/src/i18n/context";

const inputStyle: React.CSSProperties = {
  width: "100%", minHeight: 40, padding: "8px 10px", border: "1px solid #e2e8f0",
  borderRadius: 6, fontSize: 14, background: "#fff", color: "#1e293b",
};

type ProviderState = { saving: boolean; testing: boolean; message: "saved" | "connected" | "error" | null };
const idleState: ProviderState = { saving: false, testing: false, message: null };

export default function AiSettingsPage() {
  const { t } = useI18n();
  const a = t.aiSettings;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
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
      .then(async (response) => {
        if (!response.ok) throw new Error("load failed");
        return response.json();
      })
      .then((data) => {
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
        method: "PATCH",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(provider === "mimo"
          ? { provider, model: mimoModel, apiKey: mimoKey }
          : { provider, fallback1Model: fallback1, fallback2Model: fallback2, apiKey: openrouterKey }),
      });
      if (!response.ok) throw new Error("save failed");
      const data = await response.json();
      setMimoConfigured(data.mimo.configured);
      setOpenrouterConfigured(data.openRouter.configured);
      if (provider === "mimo") setMimoKey(""); else setOpenrouterKey("");
      setState({ saving: false, testing: false, message: "saved" });
    } catch {
      setState({ saving: false, testing: false, message: "error" });
    }
  }

  async function test(provider: "mimo" | "openrouter") {
    const setState = provider === "mimo" ? setMimoState : setOpenrouterState;
    setState({ saving: false, testing: true, message: null });
    try {
      const response = await fetch("/api/settings/ai/test", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          model: provider === "mimo" ? mimoModel : fallback1,
          apiKey: provider === "mimo" ? mimoKey : openrouterKey,
        }),
      });
      if (!response.ok) throw new Error("test failed");
      setState({ saving: false, testing: false, message: "connected" });
    } catch {
      setState({ saving: false, testing: false, message: "error" });
    }
  }

  if (loading) return <div style={{ color: "#94a3b8" }}>{a.loading}</div>;
  if (loadError) return <div role="alert" style={{ color: "#dc2626" }}>{a.loadError}</div>;

  function status(state: ProviderState) {
    if (state.message === "saved") return a.saved;
    if (state.message === "connected") return a.connected;
    if (state.message === "error") return a.actionError;
    return null;
  }

  const cardStyle: React.CSSProperties = { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 24 };
  const labelStyle: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 4 };
  const buttonStyle: React.CSSProperties = { minHeight: 40, padding: "8px 16px", border: "none", borderRadius: 6, background: "#2563eb", color: "#fff", fontWeight: 600, cursor: "pointer" };

  return (
    <div style={{ maxWidth: 680 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: "#1e3a5f", marginBottom: 8 }}>{a.title}</h1>
      <p style={{ color: "#64748b", marginBottom: 24 }}>{a.description}</p>
      <div style={{ display: "grid", gap: 20 }}>
        <section style={cardStyle}>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: "#1e3a5f", marginBottom: 18 }}>{a.mimoTitle}</h2>
          <label style={{ display: "block", marginBottom: 16 }}><span style={labelStyle}>{a.model}</span><input style={inputStyle} value={mimoModel} onChange={(e) => setMimoModel(e.target.value)} /></label>
          <label style={{ display: "block", marginBottom: 18 }}><span style={labelStyle}>{a.apiKey}</span><input type="password" autoComplete="new-password" spellCheck={false} style={inputStyle} value={mimoKey} placeholder={mimoConfigured ? a.configured : ""} onChange={(e) => setMimoKey(e.target.value)} /></label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <button type="button" style={buttonStyle} disabled={mimoState.saving || mimoState.testing} onClick={() => save("mimo")}>{mimoState.saving ? a.saving : a.save}</button>
            <button type="button" style={{ ...buttonStyle, background: "#475569" }} disabled={mimoState.saving || mimoState.testing} onClick={() => test("mimo")}>{mimoState.testing ? a.testing : a.testConnection}</button>
            {status(mimoState) && <span role="status" style={{ color: mimoState.message === "error" ? "#dc2626" : "#16a34a" }}>{status(mimoState)}</span>}
          </div>
        </section>

        <section style={cardStyle}>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: "#1e3a5f", marginBottom: 18 }}>{a.openrouterTitle}</h2>
          <label style={{ display: "block", marginBottom: 16 }}><span style={labelStyle}>{a.apiKey}</span><input type="password" autoComplete="new-password" spellCheck={false} style={inputStyle} value={openrouterKey} placeholder={openrouterConfigured ? a.configured : ""} onChange={(e) => setOpenrouterKey(e.target.value)} /></label>
          <label style={{ display: "block", marginBottom: 16 }}><span style={labelStyle}>{a.fallback1}</span><input style={inputStyle} value={fallback1} onChange={(e) => setFallback1(e.target.value)} /></label>
          <label style={{ display: "block", marginBottom: 18 }}><span style={labelStyle}>{a.fallback2}</span><input style={inputStyle} value={fallback2} placeholder={a.optional} onChange={(e) => setFallback2(e.target.value)} /></label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <button type="button" style={buttonStyle} disabled={openrouterState.saving || openrouterState.testing} onClick={() => save("openrouter")}>{openrouterState.saving ? a.saving : a.save}</button>
            <button type="button" style={{ ...buttonStyle, background: "#475569" }} disabled={openrouterState.saving || openrouterState.testing} onClick={() => test("openrouter")}>{openrouterState.testing ? a.testing : a.testConnection}</button>
            {status(openrouterState) && <span role="status" style={{ color: openrouterState.message === "error" ? "#dc2626" : "#16a34a" }}>{status(openrouterState)}</span>}
          </div>
        </section>
      </div>
    </div>
  );
}
