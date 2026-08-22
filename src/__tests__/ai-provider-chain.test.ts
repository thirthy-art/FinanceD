import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { runAiProviderChain, testAiProviderConnection } from "@/src/lib/ai-provider-chain";
import type { AiProviderCandidate } from "@/src/lib/ai-provider";

const VALID_EXTRACTION = {
  vendorOriginal: null, vendorNormalized: null, vendorTaxId: null, invoiceNumber: "INV-1",
  invoiceDate: null, dueDate: null, currency: "EUR", netAmount: "10.00", vatAmount: "2.00",
  grossAmount: "12.00", lines: [],
};

function candidate(fallbackLevel: 0 | 1 | 2, model = `model-${fallbackLevel}`): AiProviderCandidate {
  return {
    provider: fallbackLevel === 0 ? "mimo-direct" : "openrouter",
    model,
    endpoint: fallbackLevel === 0
      ? "https://api.xiaomimimo.com/v1/chat/completions"
      : "https://openrouter.ai/api/v1/chat/completions",
    fallbackLevel,
    apiKey: `key-${fallbackLevel}`,
  };
}

function providerResponse(content: unknown, status = 200) {
  return new Response(JSON.stringify({ choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] }), {
    status, headers: { "Content-Type": "application/json" },
  });
}

async function run(candidates = [candidate(0), candidate(1), candidate(2)], vision = false) {
  return runAiProviderChain({ candidates, userContent: "invoice text", vision, systemPrompt: "extract" });
}

beforeEach(() => vi.restoreAllMocks());

describe("deterministic AI provider chain", () => {
  it("tries providers in fixed order and stops at the first schema-valid candidate", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(providerResponse(VALID_EXTRACTION));
    const result = await run();
    expect(result).toMatchObject({ kind: "success", metadata: { provider: "openrouter", model: "model-1", fallbackLevel: 1 } });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it.each([401, 402, 403, 404, 408, 429, 500, 503])("continues after retryable HTTP %s", async (status) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("upstream detail", { status }))
      .mockResolvedValueOnce(providerResponse(VALID_EXTRACTION));
    expect((await run()).kind).toBe("success");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it.each([400, 409, 413, 415, 422])("stops after terminal HTTP %s", async (status) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("upstream detail", { status }));
    expect((await run()).kind).toBe("terminal-provider-error");
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("continues after unreadable, malformed JSON, and schema-invalid candidates", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("not-json", { status: 200 }))
      .mockResolvedValueOnce(providerResponse("not structured JSON"))
      .mockResolvedValueOnce(providerResponse({ wrong: "shape" }));
    expect((await run()).kind).toBe("providers-exhausted");
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("skips known image-incompatible candidates without calling them", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(providerResponse(VALID_EXTRACTION));
    const result = await run([candidate(0, "mimo-v2.5-pro"), candidate(1)], true);
    expect(result).toMatchObject({ kind: "success", metadata: { fallbackLevel: 1 } });
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls[0][0]).toBe("https://openrouter.ai/api/v1/chat/completions");
  });

  it("does not ask later providers after a valid result", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(providerResponse(VALID_EXTRACTION));
    expect((await run()).kind).toBe("success");
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("treats a decryption/configuration error as operational exhaustion without issuing a request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect((await run([{ ...candidate(0), apiKey: undefined, configurationError: true }])).kind).toBe("providers-exhausted");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("isolates MiMo thinking configuration from OpenRouter requests", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(providerResponse(VALID_EXTRACTION));
    await run([candidate(0)]);
    const mimoBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(mimoBody.thinking).toEqual({ type: "disabled" });

    fetchSpy.mockClear();
    await run([candidate(1)]);
    const openrouterBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(openrouterBody).not.toHaveProperty("thinking");
  });

  it("discards a failed connection-test response body", async () => {
    let cancelled = false;
    const body = new ReadableStream({ cancel: () => { cancelled = true; } });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(body, { status: 401 }));
    await expect(testAiProviderConnection(candidate(0))).resolves.toEqual({ ok: false });
    expect(cancelled).toBe(true);
  });
});
