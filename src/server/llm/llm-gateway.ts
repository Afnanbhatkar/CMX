/**
 * CodeMind X V2 — LLM Gateway (Phase 8A, V2.1).
 *
 * THE only module allowed to import a model-provider SDK. UI code (composer,
 * panels) and services never call a provider directly — they go through this
 * gateway (Phase 8A spec §6: "The composer must NEVER call a model provider
 * SDK directly. Use LLMGateway.").
 *
 * Honesty rules (RULES.md §9/§10):
 * - The model catalog below reflects MEASURED reality, not marketing: probing
 *   this transport shows that chat requests are served by "glm-4-plus"
 *   regardless of the requested model id (requested ids pass through, the
 *   transport normalizes them). The catalog therefore lists one effective
 *   model and says exactly that, instead of advertising a fake multi-model
 *   switcher.
 * - `complete()` reports the ACTUAL served model from the response payload
 *   (`servedModel`), so every run can show what really answered.
 * - When the transport gains real multi-model routing, new catalog entries
 *   flip to `available: true` without any UI change (the composer renders
 *   whatever the gateway catalog says).
 */

import ZAI from "z-ai-web-dev-sdk";

import { logError, logWarn } from "@/server/security/logger";

export const GATEWAY_PROVIDER = "zai-gateway";

/** Hard timeout for one gateway completion (same budget as before 8A). */
const COMPLETION_TIMEOUT_MS = 60_000;

/** Wire shape of a gateway chat message (provider-agnostic). */
export interface GatewayMessage {
  role: "user" | "assistant";
  content: string;
}

/** One model in the gateway catalog (see module honesty note). */
export interface GatewayModel {
  id: string;
  label: string;
  available: boolean;
  /** What the transport ACTUALLY serves for this id (measured). */
  servedModel: string | null;
  note: string | null;
}

/**
 * The measured catalog: the transport serves ONE effective chat model today.
 * `gateway-default` is the honest id for "whatever the gateway transport
 * serves by default"; the served model id is discovered from the response.
 */
const MODEL_CATALOG: GatewayModel[] = [
  {
    id: "gateway-default",
    label: "Gateway default",
    available: true,
    servedModel: "glm-4-plus",
    note: "The z.ai transport serves glm-4-plus for chat requests today; per-model routing arrives when the transport supports it.",
  },
];

export interface GatewayCompletionRequest {
  messages: GatewayMessage[];
  /** Requested model id — must exist in the catalog when provided. */
  model?: string;
  /** Explicit thinking toggle (the assistant keeps chain-of-thought off). */
  thinking?: { type: "disabled" | "enabled" };
}

export interface GatewayCompletionResult {
  content: string;
  /** The model id the response itself reports (measured, never invented). */
  servedModel: string | null;
  /** The id that was requested (null = gateway default). */
  requestedModel: string | null;
  latencyMs: number;
  usage: { inputTokens: number | null; outputTokens: number | null };
}

/** Gateway-scoped failure — routes map this to their own error contracts. */
export class LLMGatewayError extends Error {
  constructor(
    public code: "unknown-model" | "empty" | "failed" | "timeout",
    message: string,
  ) {
    super(message);
    this.name = "LLMGatewayError";
  }
}

/** Hard overall deadline for one streaming completion. */
const STREAM_TIMEOUT_MS = 120_000;
/** A single stalled read beyond this cancels the stream. */
const STREAM_STALL_MS = 45_000;

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Extract token counts that ACTUALLY exist on the response; null otherwise. */
function extractUsage(completion: unknown): {
  inputTokens: number | null;
  outputTokens: number | null;
} {
  const usage = (completion as Record<string, unknown> | null | undefined)?.usage as
    | Record<string, unknown>
    | undefined;
  return {
    inputTokens: asNumber(usage?.prompt_tokens) ?? asNumber(usage?.input_tokens),
    outputTokens: asNumber(usage?.completion_tokens) ?? asNumber(usage?.output_tokens),
  };
}

/** The model id the response itself reports; null when absent. */
function extractServedModel(completion: unknown): string | null {
  const model = (completion as Record<string, unknown> | null | undefined)?.model;
  return typeof model === "string" && model.trim().length > 0 ? model : null;
}

export const LLMGateway = {
  /** The real catalog the composer's model picker renders. */
  listModels(): GatewayModel[] {
    return MODEL_CATALOG.map((m) => ({ ...m }));
  },

  /** Resolve a requested id; unknown ids are rejected, never silently mapped. */
  resolveModel(requested?: string): GatewayModel {
    if (!requested || requested.trim().length === 0) {
      return MODEL_CATALOG[0]!;
    }
    const found = MODEL_CATALOG.find((m) => m.id === requested);
    if (!found || !found.available) {
      throw new LLMGatewayError(
        "unknown-model",
        `The LLM Gateway has no available model "${requested}".`,
      );
    }
    return found;
  },

  /**
   * One real chat completion through the provider SDK (60s hard timeout).
   * Throws LLMGatewayError("empty" | "failed") on empty/failure; the real
   * error text is logged server-side only.
   */
  async complete(request: GatewayCompletionRequest): Promise<GatewayCompletionResult> {
    const model = LLMGateway.resolveModel(request.model);
    const requestedModel = request.model?.trim() ? model.id : null;

    const zai = await ZAI.create();
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let completion: unknown;
    try {
      completion = await Promise.race([
        zai.chat.completions.create({
          messages: request.messages,
          ...(request.thinking ? { thinking: request.thinking } : {}),
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("timeout")), COMPLETION_TIMEOUT_MS);
        }),
      ]);
    } catch (error) {
      logError("llm-gateway: completion failed", {
        error: describeError(error),
        requestedModel: requestedModel ?? model.id,
      });
      throw new LLMGatewayError("failed", "The model gateway request failed.");
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
    const latencyMs = Date.now() - startedAt;

    if (!completion || typeof completion !== "object") {
      throw new LLMGatewayError("failed", "The model gateway returned an invalid response.");
    }

    const servedModel = extractServedModel(completion);
    if (servedModel && servedModel !== model.servedModel) {
      // Catalog truth drifted — warn so the catalog gets fixed.
      logWarn("llm-gateway: served model differs from catalog note", {
        requested: model.id,
        catalogServed: model.servedModel,
        actualServed: servedModel,
      });
    }

    const content =
      (completion as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]
        ?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      logWarn("llm-gateway: empty completion", { requestedModel: model.id });
      throw new LLMGatewayError("empty", "The model returned an empty response.");
    }

    return {
      content,
      servedModel,
      requestedModel,
      latencyMs,
      usage: extractUsage(completion),
    };
  },

  /**
   * One REAL token-streaming chat completion through the provider SDK.
   *
   * The gateway accepts `stream: true` and answers with OpenAI-style SSE
   * frames (`data: {"choices":[{"delta":{"content":"…"}}]}` terminated by
   * `data: [DONE]`). Every content delta is delivered through `onDelta`
   * EXACTLY as the transport produced it — no chunk is fabricated, merged,
   * or reordered downstream of the wire. When the transport does not
   * stream (plain JSON answer), the whole content is delivered through one
   * `onDelta` call instead of failing — the one-shot contract.
   *
   * Returns the SAME result shape as complete() (accumulated content,
   * served model, measured latency, usage when the final frame carries it).
   */
  async stream(
    request: GatewayCompletionRequest,
    onDelta: (text: string) => void,
  ): Promise<GatewayCompletionResult> {
    const model = LLMGateway.resolveModel(request.model);
    const requestedModel = request.model?.trim() ? model.id : null;

    const zai = await ZAI.create();
    const startedAt = Date.now();
    let response: unknown;
    try {
      response = await zai.chat.completions.create({
        messages: request.messages,
        ...(request.thinking ? { thinking: request.thinking } : {}),
        stream: true,
      });
    } catch (error) {
      logError("llm-gateway: stream open failed", {
        error: describeError(error),
        requestedModel: requestedModel ?? model.id,
      });
      throw new LLMGatewayError("failed", "The model gateway request failed.");
    }

    // Transport answered with a plain JSON completion — no stream exists.
    // Deliver the full content through ONE delta call (the one-shot path).
    if (!response || typeof (response as ReadableStream).getReader !== "function") {
      const completion = response as Record<string, unknown> | null;
      const content =
        (completion as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0]
          ?.message?.content;
      if (typeof content !== "string" || !content.trim()) {
        logWarn("llm-gateway: stream fallback returned empty completion", { requestedModel: model.id });
        throw new LLMGatewayError("empty", "The model returned an empty response.");
      }
      const servedModel = extractServedModel(completion);
      onDelta(content);
      return {
        content,
        servedModel,
        requestedModel,
        latencyMs: Date.now() - startedAt,
        usage: extractUsage(completion),
      };
    }

    /* ---- Real SSE streaming ---- */
    const reader = (response as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let servedModel: string | null = null;
    let usage = { inputTokens: null as number | null, outputTokens: null as number | null };
    const deadline = startedAt + STREAM_TIMEOUT_MS;

    const consumeFrame = (raw: string): void => {
      for (const line of raw.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(payload) as Record<string, unknown>;
        } catch {
          continue; // partial frame across reads — the split guard re-joins
        }
        const frameModel = parsed.model;
        if (typeof frameModel === "string" && frameModel.trim().length > 0 && servedModel === null) {
          servedModel = frameModel;
        }
        const frameUsage = parsed.usage as Record<string, unknown> | undefined;
        if (frameUsage) {
          usage = extractUsage({ usage: frameUsage });
        }
        const delta =
          (parsed.choices as { delta?: { content?: unknown } }[] | undefined)?.[0]?.delta?.content;
        if (typeof delta === "string" && delta.length > 0) {
          content += delta;
          onDelta(delta);
        }
      }
    };

    try {
      while (true) {
        const now = Date.now();
        if (now >= deadline) {
          throw new LLMGatewayError("timeout", "The model gateway stream timed out.");
        }
        const read = await Promise.race([
          reader.read(),
          new Promise<"stall">((resolve) => {
            setTimeout(() => resolve("stall"), Math.min(STREAM_STALL_MS, deadline - Date.now()));
          }),
        ]);
        if (read === "stall") {
          throw new LLMGatewayError("timeout", "The model gateway stream stalled.");
        }
        const { done, value } = read;
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE frames are separated by a blank line; a frame split across
        // reads stays buffered until its terminator arrives.
        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          consumeFrame(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf("\n\n");
        }
      }
      const tail = decoder.decode().trim();
      if (tail) consumeFrame(tail);
    } catch (error) {
      logError("llm-gateway: stream failed", {
        error: describeError(error),
        requestedModel: requestedModel ?? model.id,
      });
      if (error instanceof LLMGatewayError) throw error;
      throw new LLMGatewayError("failed", "The model gateway request failed.");
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // reader already closed
      }
    }

    if (!content.trim()) {
      logWarn("llm-gateway: empty stream", { requestedModel: model.id });
      throw new LLMGatewayError("empty", "The model returned an empty response.");
    }

    return {
      content,
      servedModel,
      requestedModel,
      latencyMs: Date.now() - startedAt,
      usage,
    };
  },
} as const;

export type LLMGatewayType = typeof LLMGateway;
