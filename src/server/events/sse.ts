import { securityHeaders } from "@/server/security/config";
import { logInfo } from "@/server/security/logger";

import { getEventBus } from "./bus";
import { createEvent, type CodeMindEvent } from "./types";

/**
 * CodeMind X V2 — shared SSE transport for typed events (Phase 3, spec §6/§7).
 *
 * Used by BOTH GET /api/events and GET /api/events/stream (alias). This is a
 * raw Response (NOT wrapped in withApi): the envelope layer is JSON-only, so
 * SSE routes own their headers and lifecycle.
 *
 * Behavior:
 * - `?replay=1` → the bus ring buffer is flushed first (oldest first), then
 *   the client receives live events;
 * - heartbeat: the documented choice is the TYPED `STREAM_HEARTBEAT` event —
 *   one is written immediately after the (optional) replay so clients can
 *   verify liveness without waiting, and the process-wide bus publishes one
 *   every 15 s (see bus.ts). No plain `: ping` comments are used;
 * - frame format: `event: <type>\ndata: <json>\n\n`;
 * - `req.signal` abort (client disconnect) → unsubscribe + close. The bus
 *   decouples publishers from subscribers, so a slow client never blocks a
 *   job run (`controller.enqueue` is synchronous buffering);
 * - headers: SSE-specific Cache-Control overrides the generic no-store from
 *   securityHeaders() — an event stream must not be cached end-to-end but
 *   must not be stored either.
 */

export function handleEventStream(req: Request): Response {
  const requestId = `req_${crypto.randomUUID()}`;
  const url = new URL(req.url);
  const replay = url.searchParams.get("replay") === "1";
  const bus = getEventBus();
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

      const sendEvent = (event: CodeMindEvent): void => {
        write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      };

      if (replay) {
        for (const event of bus.recent()) sendEvent(event);
      }
      // Immediate typed heartbeat after the replay window (documented above):
      // clients verify liveness without waiting for the next 15 s tick.
      sendEvent(createEvent({ type: "STREAM_HEARTBEAT" }));

      const unsubscribe = bus.subscribe(sendEvent);

      const close = (): void => {
        if (closed) return;
        closed = true;
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed by the runtime — nothing to do
        }
      };

      req.signal.addEventListener("abort", close, { once: true });
      cleanup = close;
    },
    cancel() {
      // Backstop if the runtime cancels the stream without firing abort.
      cleanup?.();
      cleanup = null;
    },
  });

  logInfo("sse stream opened", {
    path: url.pathname,
    replay,
    requestId,
  });

  return new Response(stream, {
    status: 200,
    headers: {
      ...securityHeaders(),
      // SSE-specific cache semantics override the generic no-store above.
      "Cache-Control": "no-cache, no-transform",
      "Content-Type": "text/event-stream; charset=utf-8",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "x-request-id": requestId,
    },
  });
}
