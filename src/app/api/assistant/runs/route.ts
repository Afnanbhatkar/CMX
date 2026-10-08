import { z } from "zod";

import { securityHeaders } from "@/server/security/config";
import { logError, logInfo } from "@/server/security/logger";
import { publish, subscribe } from "@/server/events/bus";
import { createEvent, type CodeMindEvent } from "@/server/events/types";
import {
  AssistantError,
  runAssistantTurn,
  type AssistantStageEvent,
} from "@/server/services/assistant-service";
import { getMemoryPreferences } from "@/server/memory/engine";
import { proposeFromUserMessage, saveProposals } from "@/server/memory/inference";
import { logWarn } from "@/server/security/logger";
import {
  cancelPendingRun,
  waitForAnswers,
} from "@/server/services/run-answers-registry";
import {
  emitErrorFrame,
  emitResultFrame,
  emitRunEvent,
  endRunStream,
  markRunPaused,
  openRunStream,
  setOrchestratorMapping,
  subscribeRunFrames,
} from "@/server/services/run-stream-registry";
import type {
  AssistantStreamEvent,
  SequencedAssistantEvent,
} from "@/features/workspace/assistant/contracts";

/**
 * POST /api/assistant/runs — the Phase 8B/8C streaming run surface
 * (Agent Mode V2 update, spec §5/§31/§56/§110).
 *
 * One real assistant turn, streamed as the 8B event contract: every wire
 * event carries a monotonic per-run `seq` (starting at 1) and uses the
 * shared AssistantStreamEvent vocabulary:
 *
 *   RUN_STARTED → ACTIVITY_* → CONTEXT_SNAPSHOT → MEMORY_USED →
 *   SEARCH_RESULT → FILE_REFERENCED → (INTAKE_QUESTIONS_REQUIRED →
 *   RUN_PAUSED …user answers via /api/assistant/runs/answers, run resumes
 *   through /api/assistant/runs/resume…) → APPROVAL_REQUIRED → RUN_PAUSED
 *   (the run BLOCKS server-side at the approval gate; the phase-1 response
 *   ENDS here — the client shows the approval INSIDE the thought chain and
 *   resumes the run through the resume stream) → RESPONSE_CHUNK →
 *   RESPONSE_STRUCTURED → CHANGE_RESULT → `result` frame → RUN_COMPLETED
 *   (or RUN_FAILED/RUN_CANCELLED).
 *
 * Every frame flows through the per-run ledger (run-stream-registry) so the
 * resume stream can REPLAY the run's full history with the same seq space —
 * reloads and reconnects never duplicate rows (client-side seq dedupe).
 *
 * First-event latency: RUN_STARTED is emitted SYNCHRONOUSLY when the stream
 * opens — before any await — so the first visible activity event does not
 * wait on validation, retrieval, or the model.
 *
 * Privacy boundary (8B §1): only safe execution summaries travel on this
 * stream. The 8C additions (context snapshot, memory records, intake
 * questions, approval payloads) carry safe execution facts — never chain-
 * of-thought. RESPONSE_CHUNK carries REAL model token deltas.
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
      /* ---- 8C Context Inspector ledger (user-controlled, enforced here) ---- */
      excludedRefs: z.array(z.string().max(512)).max(64).optional(),
      excludedMemoryIds: z.array(z.string().max(128)).max(64).optional(),
      pinnedRefs: z.array(z.string().max(512)).max(8).optional(),
    })
    .optional(),
  mode: z.enum(COMPOSER_MODES).optional(),
  model: z.string().max(64).optional(),
  /** Phase 9.5 — per-run memory policy (incognito + optional reads-off + depth). */
  memory: z
    .object({
      incognito: z.boolean().optional(),
      readsDisabled: z.boolean().optional(),
      depth: z.enum(["beginner", "standard", "expert"]).optional(),
    })
    .optional(),
});

const RESULT_NOTE =
  "The answer streamed as real model token deltas (gateway stream: true); this frame carries the authoritative final content.";

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

      const write = (chunk: string): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true; // client went away mid-write
        }
      };

      /** Liveness during the run's LONG silent phases — slow model
       *  generations, the intake pause, the approval pause. Forward ONLY
       *  the process-wide STREAM_HEARTBEAT (every 15s). Heartbeat frames
       *  carry no seq, so the client's sequenced-event parser ignores them. */
      const unsubscribeHeartbeats = subscribe((event) => {
        if (event.type === "STREAM_HEARTBEAT") {
          write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        }
      });

      // ---- The per-run frame LEDGER (Agent Mode V2) ----
      // Every sequenced frame is emitted through the ledger; this pump is
      // just one subscriber that mirrors frames onto THIS response. When the
      // run pauses, the pump detaches and the response ends — the ledger
      // keeps accumulating so the RESUME stream can replay + continue.
      openRunStream(runId);
      const pump = subscribeRunFrames(runId, 0, (frame) => {
        if (frame.kind === "event") {
          write(`event: ${frame.event.type}\ndata: ${JSON.stringify(frame.event)}\n\n`);
        } else if (frame.kind === "result") {
          write(`event: result\ndata: ${JSON.stringify(frame.frame)}\n\n`);
        } else {
          write(`event: error\ndata: ${JSON.stringify({ error: frame.message })}\n\n`);
        }
      });

      const writeEvent = (event: AssistantStreamEvent): SequencedAssistantEvent => {
        return emitRunEvent(runId, event);
      };

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
          case "RESPONSE_STRUCTURED":
            writeEvent({ type: "RESPONSE_STRUCTURED", runId, structured: stage.structured });
            break;
          case "CHANGE_RESULT":
            writeEvent({ type: "CHANGE_RESULT", runId, result: stage.result });
            break;
          case "APPROVAL_DECIDED":
            writeEvent({ type: "APPROVAL_DECIDED", runId, approvalId: stage.approvalId, decision: stage.decision });
            break;
          /* ---- 8C surfaces ---- */
          case "CONTEXT_SNAPSHOT":
            writeEvent({ type: "CONTEXT_SNAPSHOT", runId, snapshot: stage.snapshot });
            break;
          case "MEMORY_USED":
            writeEvent({ type: "MEMORY_USED", runId, memories: stage.memories, note: stage.note });
            break;
          case "INTAKE_QUESTIONS":
            writeEvent({ type: "INTAKE_QUESTIONS_REQUIRED", runId, batch: stage.batch });
            break;
          case "APPROVAL_REQUIRED":
            writeEvent({ type: "APPROVAL_REQUIRED", runId, approval: stage.approval });
            break;
        }
      };

      const close = (): void => {
        if (closed) return;
        closed = true;
        unsubscribeHeartbeats();
        pump.unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed by the runtime
        }
      };

      /* ---- Abort bridging (Agent Mode V2) ----
       * While the phase-1 stream is live, a client disconnect cancels the
       * run (honest stop). Once the run PAUSES (approval/answers), the
       * bridge stands down: the response we close ourselves must NOT cancel
       * the run — the user may close the tab for an hour and approve later
       * (spec §110: active-run rehydration). Explicit cancellation of a
       * paused run goes through POST /api/assistant/runs/cancel. */
      const runAbort = new AbortController();
      let paused = false;
      const onReqAbort = (): void => {
        if (paused) return;
        logInfo("assistant run cancelled (client disconnect)", { runId, requestId });
        cancelPendingRun(runId);
        runAbort.abort();
      };
      req.signal.addEventListener("abort", onReqAbort, { once: true });
      cleanup = close;

      /** The pause: emit RUN_PAUSED through the ledger (the phase-1 pump
       *  still delivers it), mark the ledger, then end THIS response. The
       *  run itself keeps executing server-side; the client resumes it
       *  through POST /api/assistant/runs/resume with full replay. */
      const handlePause = (info: {
        reason: "approval" | "answers";
        approvalId?: string;
        orchestratorRunId?: string;
      }): void => {
        paused = true;
        if (info.orchestratorRunId) {
          setOrchestratorMapping(runId, info.orchestratorRunId);
        }
        writeEvent({
          type: "RUN_PAUSED",
          runId,
          reason: info.reason,
          approvalId: info.approvalId,
          orchestratorRunId: info.orchestratorRunId,
        });
        markRunPaused(runId, {
          reason: info.reason,
          approvalId: info.approvalId,
          orchestratorRunId: info.orchestratorRunId,
        });
        logInfo("assistant run paused (awaiting human input)", {
          runId,
          requestId,
          reason: info.reason,
        });
        // Give the event loop one tick so the RUN_PAUSED frame flushes to
        // the socket before the response ends.
        setTimeout(() => close(), 30);
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

      void (async () => {
        publish(createEvent({ type: "ASSISTANT_STARTED", runId }));
        try {
          const runResult = await runAssistantTurn(
            {
              messages: parsed.data.messages,
              context: parsed.data.context,
              mode: parsed.data.mode,
              model: parsed.data.model,
              requestId,
              runId,
              // Phase 9.5 — memory policy: incognito/reads flags come from
              // the composer; the depth default comes from saved prefs.
              memoryPolicy: await (async () => {
                const prefs = await getMemoryPreferences().catch(() => null);
                return {
                  incognito: parsed.data.memory?.incognito ?? false,
                  readsDisabled:
                    parsed.data.memory?.readsDisabled ??
                    prefs?.incognitoMemoryReads ??
                    false,
                  depth: parsed.data.memory?.depth ?? prefs?.depth ?? "standard",
                };
              })(),
              // 8C question flow — Agent Mode V2: the pause ends THIS
              // response; the run keeps waiting and the answers route
              // resolves it. The client disconnect bridge is disarmed by
              // then (a closed tab must not cancel the paused run).
              answersProvider: () =>
                waitForAnswers(runId, () => {
                  if (!paused) runAbort.abort();
                }),
              onPause: handlePause,
              // Phase 9: opt into REAL token streaming — every gateway delta
              // becomes one sequenced RESPONSE_CHUNK on this run stream.
              onResponseDelta: (text) => {
                writeStage({ type: "RESPONSE_CHUNK", segment: { kind: "markdown", text } });
              },
              // Phase 9.6/V2: aborts flow through the BRIDGE — disconnected
              // while live → cancel; disconnected after pause → the run
              // survives (spec §110).
              signal: runAbort.signal,
            },
            writeStage,
          );

          emitResultFrame(runId, {
            seq: 0, // the ledger assigns the authoritative seq
            content: runResult.content,
            servedModel: runResult.servedModel,
            mode,
            note: runResult.note ?? RESULT_NOTE,
          });
          writeEvent({ type: "RUN_COMPLETED", runId, completedAt: Date.now() });
          publish(createEvent({ type: "ASSISTANT_COMPLETED", runId }));
          endRunStream(runId);
          logInfo("assistant run completed", {
            runId,
            requestId,
            mode,
            servedModel: runResult.servedModel,
          });

          // Phase 9.5 — memory inference (spec §6 + §13): ONLY the user's own
          // messages are mined, ONLY into the Memory Inbox as "proposed".
          // Never in incognito / reads-off runs; failures never disturb the
          // completed run (logged honestly, no fabricated success).
          const writePolicy =
            parsed.data.memory?.incognito === true ||
            (await getMemoryPreferences().catch(() => null))?.incognitoMemoryWrites === true;
          if (!writePolicy) {
            const lastUser = [...parsed.data.messages]
              .reverse()
              .find((m) => m.role === "user");
            if (lastUser) {
              try {
                const proposals = proposeFromUserMessage(lastUser.content);
                if (proposals.length > 0) {
                  await saveProposals(proposals, `chat:${runId}`);
                  logInfo("memory: inbox proposals created", {
                    runId,
                    count: proposals.length,
                  });
                }
              } catch (error) {
                logWarn("memory: inference failed (run unaffected)", {
                  runId,
                  error: error instanceof Error ? error.message : String(error),
                });
              }
            }
          }
        } catch (error) {
          const cancelled =
            error instanceof AssistantError && error.reason === "cancelled";
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
          if (cancelled) {
            writeEvent({ type: "RUN_CANCELLED", runId, cancelledAt: Date.now() });
            emitErrorFrame(runId, safeReason);
            publish(createEvent({ type: "ASSISTANT_FAILED", runId, reason: safeReason }));
          } else {
            writeEvent({ type: "RUN_FAILED", runId, error: safeReason, failedAt: Date.now() });
            emitErrorFrame(runId, safeReason);
            publish(createEvent({ type: "ASSISTANT_FAILED", runId, reason: safeReason }));
          }
          endRunStream(runId);
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
