import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Client Funds Reconciliation copy", () => {
  it("does not include the removed product/demo regulatory-compliance warning", () => {
    const englishMessages = readFileSync(new URL("../i18n/en.ts", import.meta.url), "utf8");

    expect(englishMessages).not.toContain(
      "This is a product/demo reconciliation control and is not a claim of MGA or other regulatory compliance.",
    );
  });
});
