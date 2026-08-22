import "server-only";

import { z } from "zod";
import { AiInvoiceExtractionSchema, type AiInvoiceExtraction } from "@/src/lib/ai-extraction";
import type { AiProviderCandidate, AiProviderName } from "@/src/lib/ai-provider";

const ProviderEnvelopeSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
});

export interface AiProviderMetadata {
  provider: AiProviderName;
  model: string;
  fallbackLevel: number;
}

type UserContent = string | Array<Record<string, unknown>>;

type ProviderRequestResult =
  | { kind: "response"; response: Response }
  | { kind: "operational-failure" };

export type AiProviderChainResult =
  | { kind: "success"; extraction: AiInvoiceExtraction; metadata: AiProviderMetadata }
  | { kind: "not-configured" }
  | { kind: "no-vision-provider" }
  | { kind: "terminal-provider-error" }
  | { kind: "providers-exhausted" };

export function isKnownImageIncompatibleModel(model: string): boolean {
  return model.trim().toLowerCase() === "mimo-v2.5-pro";
}

function metadata(candidate: AiProviderCandidate): AiProviderMetadata {
  return { provider: candidate.provider, model: candidate.model, fallbackLevel: candidate.fallbackLevel };
}

export async function requestChatCompletion(
  candidate: AiProviderCandidate,
  messages: Array<{ role: "system" | "user"; content: UserContent }>,
  maxCompletionTokens: number,
): Promise<ProviderRequestResult> {
  if (!candidate.apiKey || candidate.configurationError) return { kind: "operational-failure" };
  try {
    const requestExtras = new URL(candidate.endpoint).hostname.endsWith("xiaomimimo.com")
      ? { thinking: { type: "disabled" } }
      : {};
    const response = await fetch(candidate.endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${candidate.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: candidate.model,
        messages,
        response_format: { type: "json_object" },
        max_completion_tokens: maxCompletionTokens,
        stream: false,
        ...requestExtras,
      }),
      signal: AbortSignal.timeout(120_000),
      cache: "no-store",
    });
    return { kind: "response", response };
  } catch {
    return { kind: "operational-failure" };
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 401 || status === 402 || status === 403 || status === 404
    || status === 408 || status === 429 || status >= 500;
}

function isTerminalClientStatus(status: number): boolean {
  return status >= 400 && status < 500 && !isRetryableStatus(status);
}

export async function runAiProviderChain(input: {
  candidates: AiProviderCandidate[];
  userContent: UserContent;
  vision: boolean;
  systemPrompt: string;
}): Promise<AiProviderChainResult> {
  if (input.candidates.length === 0) return { kind: "not-configured" };
  const eligible = input.vision
    ? input.candidates.filter((candidate) => !isKnownImageIncompatibleModel(candidate.model))
    : input.candidates;
  if (eligible.length === 0) return { kind: "no-vision-provider" };

  for (const candidate of eligible) {
    const attempted = await requestChatCompletion(candidate, [
      { role: "system", content: input.systemPrompt },
      { role: "user", content: input.userContent },
    ], 16_384);
    if (attempted.kind === "operational-failure") continue;
    if (!attempted.response.ok) {
      const terminal = isTerminalClientStatus(attempted.response.status);
      await attempted.response.body?.cancel().catch(() => undefined);
      if (terminal) return { kind: "terminal-provider-error" };
      continue;
    }

    let providerJson: unknown;
    try {
      providerJson = await attempted.response.json();
    } catch {
      continue;
    }
    const envelope = ProviderEnvelopeSchema.safeParse(providerJson);
    if (!envelope.success) continue;

    let extractionJson: unknown;
    try {
      extractionJson = JSON.parse(envelope.data.choices[0].message.content);
    } catch {
      continue;
    }
    const extraction = AiInvoiceExtractionSchema.safeParse(extractionJson);
    if (!extraction.success) continue;
    return { kind: "success", extraction: extraction.data, metadata: metadata(candidate) };
  }
  return { kind: "providers-exhausted" };
}

export async function testAiProviderConnection(candidate: AiProviderCandidate): Promise<{
  ok: boolean;
  metadata?: AiProviderMetadata;
}> {
  const attempted = await requestChatCompletion(candidate, [
    { role: "system", content: "Return JSON only." },
    { role: "user", content: "Return exactly {\"ok\":true}." },
  ], 32);
  if (attempted.kind !== "response") return { ok: false };
  if (!attempted.response.ok) {
    await attempted.response.body?.cancel().catch(() => undefined);
    return { ok: false };
  }
  try {
    const body = ProviderEnvelopeSchema.safeParse(await attempted.response.json());
    if (!body.success) return { ok: false };
    const content = JSON.parse(body.data.choices[0].message.content) as unknown;
    if (!content || typeof content !== "object" || (content as { ok?: unknown }).ok !== true) return { ok: false };
    return { ok: true, metadata: metadata(candidate) };
  } catch {
    return { ok: false };
  }
}
