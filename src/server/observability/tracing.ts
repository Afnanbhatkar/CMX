/**
 * CodeMind X V2 — OpenTelemetry tracing foundation (V2.1 §B).
 *
 * REAL tracing, REAL spans — but HONEST about their destination:
 * - the SDK (sdk-trace-base) produces real W3C-compatible traces;
 * - finished spans go into a 500-entry IN-MEMORY ring buffer for local
 *   debugging only (`readFinishedSpansDebug()`);
 * - NOTHING is exported anywhere. No OTLP collector, no APM, no file sink is
 *   wired — that is [PLANNED] (see CODEMIND_OTEL_EXPORTER_OTLP_ENDPOINT in
 *   .env.example). Never claim spans leave this process.
 *
 * Propagation TODAY (the only hops that exist):
 *   HTTP request (withApi opens "http.request", extracting an inbound
 *   `traceparent` when present) → assistant completion
 *   ("assistant.completion" span, nested automatically) → structured request
 *   log line carries `traceId`. The LLM gateway call itself is a black box
 *   today (z-ai-web-dev-sdk accepts no custom headers), so gateway-side
 *   propagation is [PLANNED]; `injectTraceHeaders()` exists for the future
 *   job/service hops.
 *
 * Attribute privacy (RULES.md §9/§14, ARCHITECTURE.md §8):
 * - domain attributes use ONLY: request_id, repository_id, run_id, agent_id,
 *   tool_id, model, provider, job_id (plus http.* on request spans);
 * - NEVER attach secrets, tokens, prompts, model reasoning, or file contents.
 *
 * Everything here is defensive: tracing must never break a request.
 */

import {
  context as otelContext,
  propagation,
  trace,
  ROOT_CONTEXT,
  SpanStatusCode,
  type Context,
  type Span,
} from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  ExportResultCode,
  W3CTraceContextPropagator,
  type ExportResult,
} from "@opentelemetry/core";
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
  type ReadableSpan,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-base";

const TRACER_NAME = "codemind-x-v2";

/** Ring-buffer capacity for finished spans (local debug memory only). */
const RING_CAPACITY = 500;

/** Allowed domain attribute names (V2.1 §B). http.* is allowed on request spans. */
const ALLOWED_ATTR_PREFIXES = [
  "request_id",
  "repository_id",
  "run_id",
  "agent_id",
  "tool_id",
  "model",
  "provider",
  "job_id",
  "http.",
] as const;

export type SpanAttributeValue = string | number | boolean | undefined;
export type SpanAttributes = Record<string, SpanAttributeValue>;

/** A remote (incoming) trace context extracted from W3C `traceparent` headers. */
export interface RemoteTraceContext {
  traceId: string;
  spanId: string;
  /** @internal opaque OTel context — pass back to startSpan/withRequestSpan. */
  otel: Context;
}

/** Plain-object debug summary of one finished span (no SDK internals leak). */
export interface FinishedSpanDebug {
  name: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  attributes: Record<string, string | number | boolean>;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  status: string;
}

// ---------------------------------------------------------------------------
// Ring-buffer exporter (the ONLY span destination wired — in-memory, capped)
// ---------------------------------------------------------------------------

const finishedRing: ReadableSpan[] = [];

class RingBufferSpanExporter implements SpanExporter {
  export(
    spans: ReadableSpan[],
    resultCallback: (result: ExportResult) => void,
  ): void {
    try {
      for (const span of spans) {
        finishedRing.push(span);
      }
      while (finishedRing.length > RING_CAPACITY) {
        finishedRing.shift();
      }
    } catch (error) {
      // Export must never throw into the SDK.
      console.error("[tracing] ring buffer export failed:", error);
    }
    resultCallback({ code: ExportResultCode.SUCCESS });
  }

  async shutdown(): Promise<void> {
    finishedRing.length = 0;
  }
}

/**
 * Debug getter: the last 500 finished spans as plain objects.
 * Local process memory ONLY — this is not an export target.
 */
export function readFinishedSpansDebug(): FinishedSpanDebug[] {
  return finishedRing.map(summarizeSpan);
}

function summarizeSpan(span: ReadableSpan): FinishedSpanDebug {
  const sc = span.spanContext();
  const startMs = hrTimeToMs(span.startTime);
  const endMs = hrTimeToMs(span.endTime);
  const attributes: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(span.attributes)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      attributes[key] = value;
    }
  }
  return {
    name: span.name,
    traceId: sc.traceId,
    spanId: sc.spanId,
    parentSpanId: span.parentSpanContext?.spanId,
    attributes,
    startedAt: new Date(startMs).toISOString(),
    endedAt: new Date(endMs).toISOString(),
    durationMs: Math.max(0, endMs - startMs),
    status:
      span.status.code === SpanStatusCode.ERROR
        ? "error"
        : span.status.code === SpanStatusCode.OK
          ? "ok"
          : "unset",
  };
}

function hrTimeToMs(hr: readonly [number, number] | [number, number]): number {
  return hr[0] * 1000 + hr[1] / 1e6;
}

// ---------------------------------------------------------------------------
// Idempotent, crash-proof SDK setup
// ---------------------------------------------------------------------------

const GLOBAL_SETUP_KEY = "__codemind_tracing_initialized__";

let setupComplete = false;

/**
 * Register the tracer provider, W3C propagator, and async context manager.
 * Idempotent (safe under hot reload), fully guarded: any failure leaves the
 * server running WITHOUT tracing rather than crashing it.
 */
export function setupTracing(): void {
  if (setupComplete) return;
  const globalState = globalThis as typeof globalThis & {
    [GLOBAL_SETUP_KEY]?: boolean;
  };
  if (globalState[GLOBAL_SETUP_KEY]) {
    setupComplete = true;
    return;
  }
  try {
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(new RingBufferSpanExporter())],
    });
    // W3C Trace Context propagation (traceparent) — required for the
    // HTTP → assistant hop and for future job/service hops.
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());
    otelContext.setGlobalContextManager(new AsyncLocalStorageContextManager());
    // No-op (returns false) if another module instance already registered.
    trace.setGlobalTracerProvider(provider);
    setupComplete = true;
    globalState[GLOBAL_SETUP_KEY] = true;
  } catch (error) {
    console.error("[tracing] setup failed — server continues without spans:", error);
  }
}

// Lazily initialize on first import so withApi/services always have a tracer,
// even if instrumentation.ts has not run yet in this process.
setupTracing();

/** True once the real (non-noop) tracer provider is registered. */
export function isTracingActive(): boolean {
  return setupComplete;
}

function getTracer() {
  // Returns a no-op tracer until setupTracing() succeeds — never throws.
  return trace.getTracer(TRACER_NAME);
}

// ---------------------------------------------------------------------------
// Attribute sanitization (privacy gate)
// ---------------------------------------------------------------------------

function sanitizeAttrs(attrs?: SpanAttributes): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!attrs) return out;
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined) continue;
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      continue;
    }
    const allowed = ALLOWED_ATTR_PREFIXES.some((p) => key === p || key.startsWith(p));
    if (!allowed) continue; // silently drop non-allowlisted attribute names
    out[key] = value;
  }
  return out;
}

function recordSpanError(span: Span, error: unknown): void {
  try {
    span.recordException(error as Parameters<Span["recordException"]>[0]);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : String(error),
    });
  } catch {
    // never let span bookkeeping throw
  }
}

/** Uniform settle handling for sync + async fn results. */
function runInSpan<T>(span: Span, fn: () => T): T | Promise<T> {
  let result: T;
  try {
    result = fn();
  } catch (error) {
    recordSpanError(span, error);
    span.end();
    throw error;
  }
  if (result instanceof Promise) {
    return result.then(
      (value) => {
        span.end();
        return value;
      },
      (error: unknown) => {
        recordSpanError(span, error);
        span.end();
        throw error;
      },
    );
  }
  span.end();
  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run `fn` inside an active span named `name` (child of the currently active
 * span, root if none). Records real errors as span events and rethrows.
 * Works with sync and async `fn`.
 */
export function withSpan<T>(name: string, attrs: SpanAttributes | undefined, fn: () => T): T {
  const tracer = getTracer();
  const settled = tracer.startActiveSpan(
    name,
    { attributes: sanitizeAttrs(attrs) },
    (span: Span) => runInSpan(span, fn),
  );
  return settled as T;
}

/**
 * Request-span variant used by `withApi`: extracts an inbound W3C trace
 * context from `headers` (when present) and makes the new span its child.
 */
export function withRequestSpan<T>(
  name: string,
  attrs: SpanAttributes,
  headers: Headers,
  fn: () => T,
): T {
  const tracer = getTracer();
  const remote = extractTraceContext(headers);
  const settled = tracer.startActiveSpan(
    name,
    { attributes: sanitizeAttrs(attrs) },
    remote?.otel ?? otelContext.active(),
    (span: Span) => runInSpan(span, fn),
  );
  return settled as T;
}

/**
 * Parse a W3C `traceparent` (+ `tracestate`) from request headers.
 * Returns null when absent or invalid — callers must treat that as "no
 * parent trace", never invent one.
 */
export function extractTraceContext(headers: Headers): RemoteTraceContext | null {
  try {
    const carrier: Record<string, string> = {};
    headers.forEach((value, key) => {
      carrier[key.toLowerCase()] = value;
    });
    const ctx = propagation.extract(ROOT_CONTEXT, carrier);
    const spanCtx = trace.getSpanContext(ctx);
    if (spanCtx && trace.isSpanContextValid(spanCtx)) {
      return { traceId: spanCtx.traceId, spanId: spanCtx.spanId, otel: ctx };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Outbound propagation: W3C `traceparent` headers for the CURRENT trace
 * context (empty when no span is active). For future job → service hops;
 * the LLM gateway call cannot accept custom headers yet ([PLANNED]).
 */
export function injectTraceHeaders(): Record<string, string> {
  try {
    const carrier: Record<string, string> = {};
    propagation.inject(otelContext.active(), carrier);
    return carrier;
  } catch {
    return {};
  }
}

/** Current { traceId, spanId } from the active span, or null. */
export function currentTraceContext(): { traceId: string; spanId: string } | null {
  try {
    const span = trace.getSpan(otelContext.active());
    if (!span) return null;
    const sc = span.spanContext();
    if (!trace.isSpanContextValid(sc)) return null;
    return { traceId: sc.traceId, spanId: sc.spanId };
  } catch {
    return null;
  }
}

/** Attach attributes to the currently active span (no-op when none). */
export function setActiveSpanAttributes(attrs: SpanAttributes): void {
  try {
    const span = trace.getSpan(otelContext.active());
    if (!span) return;
    for (const [key, value] of Object.entries(sanitizeAttrs(attrs))) {
      span.setAttribute(key, value);
    }
  } catch {
    // never throw from span bookkeeping
  }
}

/**
 * Manual span for non-caller-wrapped flows (e.g. the background job system).
 * The span is started (optionally under a remote parent) but NOT activated —
 * it must be ended explicitly via the returned handle. Record real errors
 * with `handle.recordException(error)` or `handle.end(error)`.
 */
export interface SpanHandle {
  traceId: string;
  spanId: string;
  setAttributes(attrs: SpanAttributes): void;
  recordException(error: unknown): void;
  /** End the span; pass an error to mark it failed. */
  end(error?: unknown): void;
}

export function startSpan(
  name: string,
  attrs?: SpanAttributes,
  remoteParent?: RemoteTraceContext | null,
): SpanHandle {
  const span = getTracer().startSpan(
    name,
    { attributes: sanitizeAttrs(attrs) },
    remoteParent?.otel,
  );
  const sc = span.spanContext();
  return {
    traceId: sc.traceId,
    spanId: sc.spanId,
    setAttributes(next: SpanAttributes): void {
      try {
        for (const [key, value] of Object.entries(sanitizeAttrs(next))) {
          span.setAttribute(key, value);
        }
      } catch {
        // ignore
      }
    },
    recordException(error: unknown): void {
      recordSpanError(span, error);
    },
    end(error?: unknown): void {
      try {
        if (error !== undefined) recordSpanError(span, error);
        span.end();
      } catch {
        // ignore
      }
    },
  };
}
