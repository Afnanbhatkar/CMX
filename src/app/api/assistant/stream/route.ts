import { ZodError, type z } from "zod";

import { jsonError } from "@/server/api/envelope";
import { securityHeaders, SECURITY_CONFIG } from "@/server/security/config";
import { logError, logInfo } from "@/server/security/logger";
import { publish, subscribe } from "@/server/events/bus";
import { createEvent, type CodeMindEvent } from "@/server/events/types";
import { assistantRequestSchema } from "@/server/schemas/api";
import {
  AssistantError,
  runAssistantTurn,
  type AssistantMessage,
} from "@/server/services/assistant-service";

/**
 * POST /api/assistant/stream — SSE surface for one real assistant turn
 * (Phase 3, spec §6/§7).
 *
 * Flow (typed events on the wire AND on the process-wide bus):
 *   ASSISTANT_STARTED → (real runAssistantTurn call) → ASSISTANT_COMPLETED
 *   → standard frame `event: result` { content, note } → close
 * On failure: ASSISTANT_FAILED + `event: error` { error } — the HTTP status
 * stays 200 (SSE semantics: the stream itself opened successfully).
 *
 * STREAMING SCOPE HONESTY (spec §6): transport and event contract are live;
 * token-level streaming will switch to per-token events when the model
 * gateway exposes a streaming API — NO FAKE CHUNKING is performed. The
 * complete content arrives in one `result` frame after ASSISTANT_COMPLETED.
 * The same note is emitted inside the result frame so clients can verify it.
 *
 * The Activity row for the turn is recorded inside assistant-service
 * (single source of truth) — deliberately NOT logged twice here.
 * z-ai-web-dev-sdk runs in the backend only — this is a server route.
 */

const STREAMING_NOTE =
  "Transport and event contract are live; token-level streaming will switch to per-token events when the model gateway exposes a streaming API — no fake chunking is performed.";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const requestId = `req_${crypto.randomUUID()}`;

  // Body-size guard (parity with withApi) + validation BEFORE the stream
  // opens: invalid input gets a normal JSON envelope, never a half-open SSE.
  const rawLength = req.headers.get("content-length");
  const size = rawLength === null ? 0 : Number(rawLength);
  if (Number.isFinite(size) && size > SECURITY_CONFIG.maxBodyBytes) {
    return jsonError(
      "PAYLOAD_TOO_LARGE",
      `Request body exceeds the ${SECURITY_CONFIG.maxBodyBytes}-byte limit.`,
      { status: 413, requestId },
    );
  }

  let payload: z.infer<typeof assistantRequestSchema>;
  try {
    payload = assistantRequestSchema.parse(await req.json());
  } catch (error) {
    if (error instanceof ZodError) {
      return jsonError("VALIDATION_ERROR", "Request validation failed.", {
        status: 422,
        requestId,
        details: error.issues.map((issue) => ({
          path: issue.path.map(String).join("."),
          message: issue.message,
        })),
      });
    }
    return jsonError("BAD_REQUEST", "Invalid JSON body.", { status: 400, requestId });
  }

  const turnMessages: AssistantMessage[] =
    payload.message !== undefined
      ? [{ role: "user", content: payload.message }]
      : (payload.messages ?? []);

  const runId = `run_${crypto.randomUUID()}`;
  const encoder = new TextEncoder();

  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const write = (chunk: string): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true; // client went away mid-write
        }
      };

      const writeFrame = (event: CodeMindEvent): void => {
        write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      };

      /** One typed event → this stream's wire AND the process-wide bus. */
      const publishAndWrite = (event: CodeMindEvent): void => {
        publish(event);
        writeFrame(event);
      };

      // Liveness during the (up to 60 s) model call: forward ONLY the
      // process-wide STREAM_HEARTBEAT — this stream stays focused on its own
      // run and never mixes in unrelated job events.
      const unsubscribeHeartbeats = subscribe((event) => {
        if (event.type === "STREAM_HEARTBEAT") writeFrame(event);
      });

      const close = (): void => {
        if (closed) return;
        closed = true;
        unsubscribeHeartbeats();
        try {
          controller.close();
        } catch {
          // already closed by the runtime
        }
      };

      // Client disconnect: stop writing now. The SDK call itself cannot be
      // cancelled; it completes and its events still reach the bus only.
      req.signal.addEventListener("abort", close, { once: true });
      cleanup = close;

      void (async () => {
        try {
          publishAndWrite(createEvent({ type: "ASSISTANT_STARTED", runId }));

          const { content } = await runAssistantTurn({
            messages: turnMessages,
            context: payload.context,
          });

          publishAndWrite(createEvent({ type: "ASSISTANT_COMPLETED", runId }));

          // Final transport frame (NOT a bus event — SSE contract only):
          // the complete content, plus the streaming-scope honesty note.
          write(
            `event: result\ndata: ${JSON.stringify({ content, note: STREAMING_NOTE })}\n\n`,
          );
          logInfo("assistant stream completed", { runId, requestId });
        } catch (error) {
          const safeReason =
            error instanceof AssistantError
              ? error.message
              : "The assistant request failed. You can retry.";
          if (!(error instanceof AssistantError)) {
            logError("assistant stream failed", {
              runId,
              requestId,
              error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
            });
          }
          publishAndWrite(createEvent({ type: "ASSISTANT_FAILED", runId, reason: safeReason }));
          write(`event: error\ndata: ${JSON.stringify({ error: safeReason })}\n\n`);
        } finally {
          close();
          cleanup = null;
        }
      })();
    },
    cancel() {
      cleanup?.();
      cleanup = null;
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      ...securityHeaders(),
      "Cache-Control": "no-cache, no-transform",
      "Content-Type": "text/event-stream; charset=utf-8",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "x-request-id": requestId,
    },
  });
}
