"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useI18n } from "@/src/i18n/context";
import { SUPPORTED_BASE_CURRENCIES } from "@/src/lib/supported-base-currencies";

export interface CompanySummary {
  id: number;
  name: string;
  baseCurrency: string;
}

export interface CompaniesResponse {
  companies: CompanySummary[];
  activeCompanyId: number | null;
}

type RequestState = "idle" | "loading" | "error";
type ActionError = "couldNotSwitch" | "couldNotCreate";

interface CompanySwitcherProps {
  initialData?: CompaniesResponse;
  initialLoadError?: boolean;
  initialActionError?: ActionError;
}

async function expectSuccess(response: Response) {
  if (!response.ok) throw new Error(`Company request failed with status ${response.status}`);
}

export async function switchActiveCompany(
  companyId: number,
  fetchImpl: typeof fetch = fetch,
  reload: () => void = () => window.location.reload(),
) {
  const response = await fetchImpl("/api/companies/active", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ companyId }),
  });
  await expectSuccess(response);
  reload();
}

export async function createCompany(
  name: string,
  baseCurrency: string,
  fetchImpl: typeof fetch = fetch,
  reload: () => void = () => window.location.reload(),
) {
  const response = await fetchImpl("/api/companies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: name.trim(),
      baseCurrency: baseCurrency.trim().toUpperCase(),
    }),
  });
  await expectSuccess(response);
  reload();
}

export function resolveDisplayedCompany(
  companies: CompanySummary[],
  activeCompanyId: number | null,
) {
  return companies.find((company) => company.id === activeCompanyId)
    ?? (companies.length === 1 ? companies[0] : null);
}

export default function CompanySwitcher({
  initialData,
  initialLoadError = false,
  initialActionError,
}: CompanySwitcherProps = {}) {
  const { t } = useI18n();
  const c = t.companySwitcher;
  const [companies, setCompanies] = useState<CompanySummary[]>(initialData?.companies ?? []);
  const [activeCompanyId, setActiveCompanyId] = useState<number | null>(initialData?.activeCompanyId ?? null);
  const [loadState, setLoadState] = useState<RequestState>(
    initialLoadError ? "error" : initialData ? "idle" : "loading",
  );
  const [isOpen, setIsOpen] = useState(Boolean(initialActionError));
  const [showCreate, setShowCreate] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ActionError | null>(initialActionError ?? null);
  const [name, setName] = useState("");
  const [baseCurrency, setBaseCurrency] = useState("EUR");

  useEffect(() => {
    if (initialData || initialLoadError) return;
    const controller = new AbortController();

    async function loadCompanies() {
      try {
        const response = await fetch("/api/companies", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Could not load companies");
        const data = await response.json() as CompaniesResponse;
        setCompanies(data.companies);
        setActiveCompanyId(data.activeCompanyId);
        setLoadState("idle");
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setLoadState("error");
      }
    }

    void loadCompanies();
    return () => controller.abort();
  }, [initialData, initialLoadError]);

  const activeCompany = useMemo(
    () => resolveDisplayedCompany(companies, activeCompanyId),
    [activeCompanyId, companies],
  );

  const controlLabel = loadState === "loading"
    ? t.common.loading
    : loadState === "error"
      ? c.couldNotLoad
      : activeCompany?.name ?? c.selectCompany;

  async function handleSwitch(companyId: number) {
    if (pending || companyId === activeCompany?.id) return;
    setPending(true);
    setError(null);
    try {
      await switchActiveCompany(companyId);
    } catch {
      setError("couldNotSwitch");
      setPending(false);
    }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await createCompany(name, baseCurrency);
    } catch {
      setError("couldNotCreate");
      setPending(false);
    }
  }

  return (
    <div className="company-switcher">
      <button
        type="button"
        className={`company-switcher-control${!activeCompany && loadState === "idle" ? " company-switcher-control-attention" : ""}`}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        onClick={() => setIsOpen((open) => !open)}
        disabled={loadState === "loading"}
        title={controlLabel}
      >
        <span className="company-switcher-control-label">{controlLabel}</span>
        <span aria-hidden="true">▾</span>
      </button>

      {isOpen && loadState !== "loading" && (
        <div className="company-switcher-panel">
          {loadState === "error" ? (
            <p className="company-switcher-error" role="status">{c.couldNotLoad}</p>
          ) : (
            <>
              <div role="menu" className="company-switcher-list">
                {companies.map((company) => {
                  const isActive = company.id === activeCompany?.id;
                  return (
                    <button
                      type="button"
                      role="menuitem"
                      className={`company-switcher-option${isActive ? " company-switcher-option-active" : ""}`}
                      key={company.id}
                      disabled={pending || isActive}
                      onClick={() => void handleSwitch(company.id)}
                    >
                      <span className="company-switcher-check" aria-hidden="true">{isActive ? "✓" : ""}</span>
                      <span className="company-switcher-option-name" title={company.name}>{company.name}</span>
                      <span className="company-switcher-currency">{company.baseCurrency}</span>
                    </button>
                  );
                })}
              </div>

              {!showCreate ? (
                <button
                  type="button"
                  className="company-switcher-create-link"
                  disabled={pending}
                  onClick={() => {
                    setShowCreate(true);
                    setError(null);
                  }}
                >
                  + {c.createCompany}
                </button>
              ) : (
                <form className="company-switcher-form" onSubmit={handleCreate}>
                  <label>
                    <span>{c.companyName}</span>
                    <input
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      required
                      maxLength={255}
                      disabled={pending}
                      autoFocus
                    />
                  </label>
                  <label>
                    <span>{c.baseCurrency}</span>
                    <select
                      value={baseCurrency}
                      onChange={(event) => setBaseCurrency(event.target.value)}
                      required
                      className="company-switcher-currency-input"
                      disabled={pending}
                    >
                      {SUPPORTED_BASE_CURRENCIES.map((currency) => (
                        <option key={currency} value={currency}>{currency}</option>
                      ))}
                    </select>
                  </label>
                  <div className="company-switcher-form-actions">
                    <button type="submit" disabled={pending}>{pending ? c.creating : c.create}</button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        setShowCreate(false);
                        setError(null);
                      }}
                    >
                      {t.common.cancel}
                    </button>
                  </div>
                </form>
              )}
            </>
          )}
          {error && <p className="company-switcher-error" role="alert">{c[error]}</p>}
        </div>
      )}
    </div>
  );
}
