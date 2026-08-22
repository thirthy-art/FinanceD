import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/dev/layout-probe/route";
import { MAX_LAYOUT_PROBE_BYTES } from "@/app/dev/layout-probe/layout-probe-shared";

const fixturePath = path.join(
  process.cwd(),
  "src/__tests__/fixtures/layout/minimal-layout-invoice.pdf",
);

function requestWithFile(file: File | null) {
  const form = new FormData();
  if (file) form.append("file", file);
  return new Request("http://localhost/api/dev/layout-probe", { method: "POST", body: form });
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

  it("returns not-found in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = await POST(requestWithFile(await fixtureFile()));
    expect(response.status).toBe(404);
  });
});
