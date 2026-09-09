import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import Home from "@/app/page";
import InvoicePaymentFilter from "@/src/components/InvoicePaymentFilter";
import { I18nProvider } from "@/src/i18n/context";
import { getMessages } from "@/src/i18n/index";
import type { Locale } from "@/src/i18n/types";

const mocks = vi.hoisted(() => ({
  locale: "en" as Locale,
  query: "",
  replace: vi.fn(),
  company: vi.fn(),
  select: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: mocks.locale }) }) }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams(mocks.query),
}));
vi.mock("@/src/lib/active-company-page", () => ({ getActiveCompanyForPage: mocks.company }));
vi.mock("@/src/db", () => ({ getDb: () => ({ select: mocks.select }) }));

const invoice = {
  id: 1034, vendorName: "Stripe", invoiceNumber: "INV-1034", invoiceDate: "2026-08-30",
  grossAmount: "2450.00", currency: "EUR", currencyType: "fiat",
  status: "draft", paymentStatus: "Paid", createdAt: new Date("2026-08-31"),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.locale = "en";
  mocks.query = "";
  mocks.company.mockResolvedValue({ id: 7 });
  mocks.orderBy.mockResolvedValue([invoice]);
  mocks.limit.mockResolvedValue([]);
  mocks.where.mockReturnValue({ orderBy: mocks.orderBy, limit: mocks.limit });
  mocks.select.mockReturnValue({ from: () => ({ leftJoin: () => ({ where: mocks.where }), where: mocks.where }) });
});

async function markup(query: { payment?: string | string[]; deleted?: string | string[] } = {}) {
  return renderToStaticMarkup(<I18nProvider initialLocale={mocks.locale}>{await Home({ searchParams: Promise.resolve(query) })}</I18nProvider>);
}

describe("invoice list", () => {
  it("keeps company/payment predicates and newest-created ordering", async () => {
    await markup({ payment: ["paid", "unpaid"] });
    const dialect = new PgDialect();
    expect(dialect.sqlToQuery(mocks.where.mock.calls[0][0]).params).toEqual([7, "Paid"]);
    expect(dialect.sqlToQuery(mocks.orderBy.mock.calls[0][0]).sql).toContain('"created_at" desc');
  });

  it("defaults an unknown payment value to All without adding a predicate", async () => {
    const html = await markup({ payment: "overdue" });
    expect(new PgDialect().sqlToQuery(mocks.where.mock.calls[0][0]).params).toEqual([7]);
    expect(html).toMatch(/aria-pressed="true">All<\/button>/);
  });

  it("keeps export unfiltered, five columns, review destinations, and independent states", async () => {
    const html = await markup({ payment: "paid" });
    const form = html.match(/<form[^>]*>[\s\S]*?<\/form>/)?.[0];
    expect(form).toContain('action="/api/invoices/export"');
    expect(form).toContain('method="get"');
    expect(form).not.toContain('name="payment"');
    expect(html.match(/scope="col"/g)).toHaveLength(5);
    expect(html.match(/href="\/invoices\/1034"/g)).toHaveLength(3);
    expect(html).toContain("INV-1034");
    expect(html).toContain("#1034");
    expect(html).toContain("2026-08-30");
    expect(html).toContain(`>${getMessages("en").common.statusDraft}</span>`);
    expect(html).toContain(`>${getMessages("en").common.statusPaid}</span>`);
  });

  it("preserves complete crypto precision, currency symbols and missing values on both layouts", async () => {
    mocks.orderBy.mockResolvedValue([{ ...invoice, vendorName: null, invoiceNumber: null, invoiceDate: null,
      currencyType: "crypto", currency: "LONG_CRYPTO_SYMBOL20", grossAmount: "12345678901234567890.123456789012345678" }]);
    const html = await markup();
    expect(html.match(/12345678901234567890\.123456789012345678/g)).toHaveLength(2);
    expect(html.match(/LONG_CRYPTO_SYMBOL20/g)).toHaveLength(2);
    expect(html).toContain(getMessages("en").common.none);
  });

  it.each(["en", "ru", "he"] as const)("preserves localized controls, notices, and upload in %s", async locale => {
    mocks.locale = locale;
    const html = await markup({ deleted: ["1", "0"] });
    const t = getMessages(locale).invoiceList;
    for (const label of [t.title, t.colInvoice, t.colWorkflow, t.exportAll, t.deleted, t.newInvoice]) expect(html).toContain(label);
    expect(html).toContain('type="file"');
    expect(html).toContain('role="status"');
  });

  it("distinguishes a company with no invoices from an empty payment result", async () => {
    mocks.orderBy.mockResolvedValue([]);
    expect(await markup()).toContain(getMessages("en").invoiceList.noInvoicesTitle);
    mocks.limit.mockResolvedValue([{ id: 1034 }]);
    const html = await markup({ payment: "unpaid" });
    expect(html).toContain(getMessages("en").invoiceList.noFilterResults);
    expect(html).not.toContain(getMessages("en").invoiceList.noInvoicesTitle);
  });

  it("does not query invoices when company selection is required", async () => {
    mocks.company.mockResolvedValue(null);
    await markup();
    expect(mocks.select).not.toHaveBeenCalled();
  });
});

describe("payment segments", () => {
  it.each(["all", "unpaid", "paid"] as const)("selects %s while preserving other URL state and scroll", value => {
    mocks.query = "deleted=1&payment=paid&extra=keep";
    const element = InvoicePaymentFilter({ label: "Payment", allLabel: "All", unpaidLabel: "Unpaid", paidLabel: "Paid", value: "paid" });
    const buttons = element.props.children[1].props.children as ReactElement<{ onClick: () => void; "aria-pressed": boolean }>[];
    buttons.find(button => button.key === value)!.props.onClick();
    const expected = new URLSearchParams(mocks.query);
    if (value === "all") expected.delete("payment");
    else expected.set("payment", value);
    expect(mocks.replace).toHaveBeenCalledWith(`/?${expected}`, { scroll: false });
    expect(buttons.filter(button => button.props["aria-pressed"])).toHaveLength(1);
  });

  it("removes the question mark when All clears the last query parameter", () => {
    mocks.query = "payment=unpaid";
    const element = InvoicePaymentFilter({ label: "Payment", allLabel: "All", unpaidLabel: "Unpaid", paidLabel: "Paid", value: "unpaid" });
    element.props.children[1].props.children[0].props.onClick();
    expect(mocks.replace).toHaveBeenCalledWith("/", { scroll: false });
  });
});
