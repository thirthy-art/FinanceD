import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  AI_SETTINGS_ADMIN_COOKIE,
  createAiSettingsAdminToken,
} from "@/src/lib/ai-settings-admin-auth";
import { POST } from "@/app/api/dev/layout-probe/route";
import { MAX_LAYOUT_PROBE_BYTES } from "@/app/dev/layout-probe/layout-probe-shared";

const ADMIN_SECRET = "layout-probe-route-test-admin-secret";

function adminCookieHeader() {
  const token = createAiSettingsAdminToken();
  if (!token) throw new Error("Test requires AI_SETTINGS_ADMIN_SECRET.");
  return `${AI_SETTINGS_ADMIN_COOKIE}=${token}`;
}

const fixturePath = path.join(
  process.cwd(),
  "src/__tests__/fixtures/layout/minimal-layout-invoice.pdf",
);

function requestWithFile(file: File | null, cookie?: string) {
  const form = new FormData();
  if (file) form.append("file", file);
  return new Request("http://localhost/api/dev/layout-probe", {
    method: "POST",
    headers: cookie ? { Cookie: cookie } : undefined,
    body: form,
  });
}

async function fixtureFile() {
  const bytes = await readFile(fixturePath);
  return new File([bytes], "minimal-layout-invoice.pdf", { type: "application/pdf" });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("dev layout-probe route", () => {
  it("extracts deterministic evidence and table candidates from a born-digital PDF", async () => {
    const response = await POST(requestWithFile(await fixtureFile()));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const body = await response.json();
    expect(body.evidence.formatVersion).toBe("1");
    expect(body.evidence.pages).toHaveLength(1);
    expect(body.evidence.pages[0].elements.map((element: { text: string }) => element.text))
      .toEqual(expect.arrayContaining(["LAYOUT PROBE INVOICE", "Description", "200.00"]));
    expect(body.tables[0]).toMatchObject({ page: 1, columnCount: 3, rowCount: 3 });

    const knownIds = new Set(
      body.evidence.pages[0].elements.map((element: { id: string }) => element.id),
    );
    for (const table of body.tables) {
      for (const row of table.rows) {
        for (const cell of row.cells) {
          expect(cell.evidenceElementIds.every((id: string) => knownIds.has(id))).toBe(true);
        }
      }
    }
  });

  it("rejects requests without a file", async () => {
    const response = await POST(requestWithFile(null));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/one PDF file/);
  });

  it("rejects empty files", async () => {
    const response = await POST(
      requestWithFile(new File([], "empty.pdf", { type: "application/pdf" })),
    );
    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatch(/empty/);
  });

  it("rejects non-PDF files even with PDF-looking content", async () => {
    const bytes = await readFile(fixturePath);
    const response = await POST(
      requestWithFile(new File([bytes], "notes.txt", { type: "text/plain" })),
    );
    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatch(/Only PDF files/);
  });

  it("rejects files above the 25 MiB budget", async () => {
    const big = new File([new Uint8Array(MAX_LAYOUT_PROBE_BYTES + 1)], "big.pdf", {
      type: "application/pdf",
    });
    const response = await POST(requestWithFile(big));
    expect(response.status).toBe(413);
  });

  it("rejects PDF-named files without PDF magic bytes", async () => {
    const fake = new File([new TextEncoder().encode("this is not a pdf")], "fake.pdf", {
      type: "application/pdf",
    });
    const response = await POST(requestWithFile(fake));
    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatch(/not a valid PDF/);
  });

  it("returns not-found in production when the flag is absent or false", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AI_SETTINGS_ADMIN_SECRET", ADMIN_SECRET);
    expect((await POST(requestWithFile(await fixtureFile()))).status).toBe(404);

    vi.stubEnv("LAYOUT_PROBE_ENABLED", "false");
    const authorized = await POST(requestWithFile(await fixtureFile(), adminCookieHeader()));
    expect(authorized.status).toBe(404);
  });

  it("denies production requests without the AI Settings admin session", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LAYOUT_PROBE_ENABLED", "true");
    vi.stubEnv("AI_SETTINGS_ADMIN_SECRET", ADMIN_SECRET);

    expect((await POST(requestWithFile(await fixtureFile()))).status).toBe(404);
    const wrongCookie = await POST(requestWithFile(await fixtureFile(), `${AI_SETTINGS_ADMIN_COOKIE}=v1.0.invalid`));
    expect(wrongCookie.status).toBe(404);
  });

  it("serves production requests with the flag enabled and a valid admin session", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LAYOUT_PROBE_ENABLED", "true");
    vi.stubEnv("AI_SETTINGS_ADMIN_SECRET", ADMIN_SECRET);

    const response = await POST(requestWithFile(await fixtureFile(), adminCookieHeader()));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.evidence.pages).toHaveLength(1);
    expect(body.tables[0]).toMatchObject({ page: 1, columnCount: 3, rowCount: 3 });
  });
});
