import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import VendorListActions from "@/src/components/VendorListActions";

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

const callbacks = { onDeleted: () => undefined, onError: () => undefined };

describe("vendor list actions", () => {
  it("shows a direct Delete action only for vendors with no invoices", () => {
    const deletable = renderToStaticMarkup(
      <VendorListActions vendor={{ id: 1, name: "Unused", invoiceCount: 0, possibleDuplicate: false }} {...callbacks} />,
    );
    const referenced = renderToStaticMarkup(
      <VendorListActions vendor={{ id: 2, name: "Used", invoiceCount: 1, possibleDuplicate: false }} {...callbacks} />,
    );
    expect(deletable).toContain(">Delete</button>");
    expect(referenced).not.toContain(">Delete</button>");
  });

  it("shows a duplicate-resolution link for a possible duplicate with invoice references", () => {
    const markup = renderToStaticMarkup(
      <VendorListActions vendor={{ id: 7, name: "Duplicate", invoiceCount: 3, possibleDuplicate: true }} {...callbacks} />,
    );
    expect(markup).toContain("Merge / resolve duplicate");
    expect(markup).toContain("/settings/vendors/7?action=merge#vendor-actions");
  });
});
