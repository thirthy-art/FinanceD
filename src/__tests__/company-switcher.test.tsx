import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import CompanySwitcher, {
  createCompany,
  resolveDisplayedCompany,
  switchActiveCompany,
} from "@/src/components/CompanySwitcher";

vi.mock("@/src/i18n/context", async () => {
  const { getMessages } = await import("@/src/i18n/index");
  return {
    useI18n: () => ({
      locale: "en" as const,
      t: getMessages("en"),
      setLocale: () => undefined,
    }),
  };
});

function response(ok = true): Response {
  return { ok, status: ok ? 200 : 500 } as Response;
}

describe("CompanySwitcher requests", () => {
  const companies = [
    { id: 2, name: "Company A", baseCurrency: "EUR" },
    { id: 7, name: "Company B", baseCurrency: "GBP" },
  ];

  it("displays the active company name", () => {
    const markup = renderToStaticMarkup(
      <CompanySwitcher initialData={{ companies, activeCompanyId: 7 }} />,
    );
    expect(markup).toContain("Company B");
    expect(markup).not.toContain("Select company");
  });

  it("shows Select company for an ambiguous response without guessing a company", () => {
    const markup = renderToStaticMarkup(
      <CompanySwitcher initialData={{ companies, activeCompanyId: null }} />,
    );
    expect(markup).toContain("Select company");
    expect(resolveDisplayedCompany(companies, null)).toBeNull();
  });

  it("renders a safe loading state before the no-store company request resolves", () => {
    const markup = renderToStaticMarkup(<CompanySwitcher />);
    expect(markup).toContain("Loading…");
    expect(markup).not.toContain("Company A");
  });

  it("renders a non-destructive translated load error", () => {
    const markup = renderToStaticMarkup(<CompanySwitcher initialLoadError />);
    expect(markup).toContain("Could not load companies");
  });

  it("selects the requested numeric company and hard reloads on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response());
    const reload = vi.fn();

    await switchActiveCompany(7, fetchMock, reload);

    expect(fetchMock).toHaveBeenCalledWith("/api/companies/active", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ companyId: 7 }),
    }));
    expect(reload).toHaveBeenCalledOnce();
  });

  it("does not reload when company selection fails", async () => {
    const reload = vi.fn();
    await expect(switchActiveCompany(7, vi.fn().mockResolvedValue(response(false)), reload)).rejects.toThrow();
    expect(reload).not.toHaveBeenCalled();
    const markup = renderToStaticMarkup(
      <CompanySwitcher initialData={{ companies, activeCompanyId: 2 }} initialActionError="couldNotSwitch" />,
    );
    expect(markup).toContain("Could not switch company");
  });

  it("creates a company with a trimmed name and uppercase currency, then hard reloads", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response());
    const reload = vi.fn();

    await createCompany("  Real Company  ", " eur ", fetchMock, reload);

    expect(fetchMock).toHaveBeenCalledWith("/api/companies", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ name: "Real Company", baseCurrency: "EUR" }),
    }));
    expect(reload).toHaveBeenCalledOnce();
  });

  it("preserves the page without a reload when company creation fails", async () => {
    const reload = vi.fn();
    await expect(createCompany("Real Company", "EUR", vi.fn().mockResolvedValue(response(false)), reload)).rejects.toThrow();
    expect(reload).not.toHaveBeenCalled();
    const markup = renderToStaticMarkup(
      <CompanySwitcher initialData={{ companies, activeCompanyId: 2 }} initialActionError="couldNotCreate" />,
    );
    expect(markup).toContain("Could not create company");
  });
});
