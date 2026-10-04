import { z } from "zod";

import { securityHeaders } from "@/server/security/config";
import { logError, logInfo } from "@/server/security/logger";
import { publish } from "@/server/events/bus";
import { createEvent } from "@/server/events/types";
import {
  AssistantError,
  runAssistantTurn,
  type AssistantStageEvent,
} from "@/server/services/assistant-service";
import type { SequencedAssistantEvent } from "@/features/workspace/assistant/contracts";

/**
 * POST /api/assistant/runs — the Phase 8B streaming run surface.
 *
 * One real assistant turn, streamed as the 8B event contract: every wire
 * event carries a monotonic per-run `seq` (starting at 1) and uses the
 * shared AssistantStreamEvent vocabulary:
 *
 *   RUN_STARTED → ACTIVITY_STARTED/UPDATED/COMPLETED → SEARCH_RESULT →
 *   FILE_REFERENCED → RESPONSE_CHUNK → `result` frame → RUN_COMPLETED
 *   (or RUN_FAILED + `error` frame; RUN_CANCELLED is published on the bus
 *   when the client disconnects).
 *
 * First-event latency: RUN_STARTED is written SYNCHRONOUSLY when the stream
 * opens — before any await — so the first visible activity event does not
 * wait on validation, retrieval, or the model. The measured server-side
 * first-event latency is logged with the run.
 *
 * Privacy boundary (8B §1): only safe execution summaries travel on this
 * stream. APPROVAL_REQUIRED / QUESTION_REQUIRED are part of the contract
 * but are NEVER emitted by this route yet — no approval/question logic is
 * connected (8B non-goals). RESPONSE_CHUNK arrives as ONE honest chunk
 * because the model gateway has no token-streaming API — nothing is
 * re-dressed as fake chunking.
 */

const COMPOSER_MODES = ["search", "code", "agent", "loop"] as const;

const bodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(8_000),
      }),
    )
    .min(1)
    .max(30),
  context: z
    .object({
      repository: z.string().max(128).optional(),
      branch: z.string().max(128).optional(),
      activeFile: z.string().max(512).optional(),
      selectedCode: z.string().max(8_000).optional(),
      attachments: z
        .array(
          z.object({
            kind: z.enum(["repository-file", "selection", "session-file"]),
            label: z.string().max(256),
            path: z.string().max(512).nullable().optional(),
          }),
        )
        .max(8)
        .optional(),
    })
    .optional(),
  mode: z.enum(COMPOSER_MODES).optional(),
  model: z.string().max(64).optional(),
});

/** The transport-only frame carrying the complete answer (SSE contract). */
interface ResultFrame {
  seq: number;
  content: string;
  servedModel: string | null;
  mode: string;
  note: string;
}

const RESULT_NOTE =
  "The complete answer arrives as one chunk — the model gateway has no token-streaming API yet; no fake chunking is performed.";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const requestId = `req_${crypto.randomUUID()}`;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400, headers: { "x-request-id": requestId } },
    );
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: "Invalid request payload." },
      { status: 400, headers: { "x-request-id": requestId } },
    );
  }

  const runId = `run_${crypto.randomUUID()}`;
  const mode = parsed.data.mode ?? "search";
  const receivedAt = Date.now();
  const encoder = new TextEncoder();

  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let seq = 0;

      const write = (chunk: string): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true; // client went away mid-write
        }
      };

      const writeEvent = (event: SequencedAssistantEvent): void => {
        seq += 1;
        const withSeq = { ...event, seq } as SequencedAssistantEvent;
        write(`event: ${withSeq.type}\ndata: ${JSON.stringify(withSeq)}\n\n`);
      };

      // FIRST EVENT — synchronous, before any await. Measured target ~300ms
      // includes network + client parse; server-side this is ~0ms.
      writeEvent({
        type: "RUN_STARTED",
        runId,
        conversationId: null,
        startedAt: Date.now(),
        mode,
      });
      const firstEventMs = Date.now() - receivedAt;
      logInfo("assistant run: first event written", { runId, requestId, firstEventMs });

      /** Map one service stage event onto the sequenced wire contract. */
      const writeStage = (stage: AssistantStageEvent): void => {
        switch (stage.type) {
          case "ACTIVITY_STARTED":
            writeEvent({
              type: "ACTIVITY_STARTED",
              runId,
              activity: {
                ...stage.activity,
                status: "active",
                startedAt: Date.now(),
                completedAt: null,
              },
            });
            break;
          case "ACTIVITY_UPDATED":
            writeEvent({
              type: "ACTIVITY_UPDATED",
              runId,
              activityId: stage.activityId,
              patch: stage.patch,
            });
            break;
          case "ACTIVITY_COMPLETED":
            writeEvent({
              type: "ACTIVITY_COMPLETED",
              runId,
              activityId: stage.activityId,
              summary: stage.summary,
              completedAt: Date.now(),
            });
            break;
          case "SEARCH_RESULT":
            writeEvent({
              type: "SEARCH_RESULT",
              runId,
              query: stage.query,
              hits: stage.hits,
              topFiles: stage.topFiles,
            });
            break;
          case "FILE_REFERENCED":
            writeEvent({ type: "FILE_REFERENCED", runId, path: stage.path, line: stage.line });
            break;
          case "RESPONSE_CHUNK":
            writeEvent({ type: "RESPONSE_CHUNK", runId, segment: stage.segment });
            break;
        }
      };

      const close = (): void => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed by the runtime
        }
      };

      // Client disconnect: stop writing; the run is cancelled from the
      // caller's perspective (the SDK call itself cannot be aborted). The
      // process-wide bus keeps its existing lifecycle vocabulary; the
      // cancellation is recorded in the log only.
      req.signal.addEventListener(
        "abort",
        () => {
          logInfo("assistant run cancelled (client disconnect)", { runId, requestId });
          close();
        },
        { once: true },
      );
      cleanup = close;

      void (async () => {
        publish(createEvent({ type: "ASSISTANT_STARTED", runId }));
        try {
          const { content, servedModel } = await runAssistantTurn(
            {
              messages: parsed.data.messages,
              context: parsed.data.context,
              mode: parsed.data.mode,
              model: parsed.data.model,
              requestId,
            },
            writeStage,
          );

          seq += 1;
          const resultFrame: ResultFrame = {
            seq,
            content,
            servedModel,
            mode,
            note: RESULT_NOTE,
          };
          write(`event: result\ndata: ${JSON.stringify(resultFrame)}\n\n`);

          writeEvent({ type: "RUN_COMPLETED", runId, completedAt: Date.now() });
          publish(createEvent({ type: "ASSISTANT_COMPLETED", runId }));
          logInfo("assistant run completed", { runId, requestId, mode, servedModel });
        } catch (error) {
          const safeReason =
            error instanceof AssistantError
              ? error.message
              : "The assistant request failed. You can retry.";
          if (!(error instanceof AssistantError)) {
            logError("assistant run failed", {
              runId,
              requestId,
              error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
            });
          }
          writeEvent({ type: "RUN_FAILED", runId, error: safeReason, failedAt: Date.now() });
          write(`event: error\ndata: ${JSON.stringify({ error: safeReason })}\n\n`);
          publish(createEvent({ type: "ASSISTANT_FAILED", runId, reason: safeReason }));
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
