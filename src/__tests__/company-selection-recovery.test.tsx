import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CompanySelectionRequired from "@/src/components/CompanySelectionRequired";
import { ActiveCompanySelectionRequiredError } from "@/src/lib/active-company";
import { getActiveCompanyForPage } from "@/src/lib/active-company-page";

describe("server page company-selection recovery", () => {
  it("turns only ActiveCompanySelectionRequiredError into the recovery-safe page state", async () => {
    const company = await getActiveCompanyForPage(async () => {
      throw new ActiveCompanySelectionRequiredError();
    });

    expect(company).toBeNull();
    expect(renderToStaticMarkup(<CompanySelectionRequired locale="en" />))
      .toContain("Select a company above to continue.");
  });

  it("does not swallow unrelated errors", async () => {
    const unexpected = new Error("database unavailable");

    await expect(getActiveCompanyForPage(async () => {
      throw unexpected;
    })).rejects.toBe(unexpected);
  });

  it("renders the recovery message through every supported locale", () => {
    expect(renderToStaticMarkup(<CompanySelectionRequired locale="en" />)).toContain("Select a company");
    expect(renderToStaticMarkup(<CompanySelectionRequired locale="ru" />)).toContain("Выберите компанию");
    expect(renderToStaticMarkup(<CompanySelectionRequired locale="he" />)).toContain("בחרו חברה");
  });
});
