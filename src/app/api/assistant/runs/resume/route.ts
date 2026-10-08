import { z } from "zod";

import { securityHeaders } from "@/server/security/config";
import { logInfo, logWarn } from "@/server/security/logger";
import {
  getOrchestratorMapping,
  getRunPause,
  getRunStreamLastSeq,
  hasRunStream,
  subscribeRunFrames,
} from "@/server/services/run-stream-registry";
import { getRunState } from "@/server/orchestrator/engine";

/**
 * POST /api/assistant/runs/resume — Agent Mode V2 resume stream
 * (spec §4 "RESUME SAME RUN", §32, §110).
 *
 * A paused run (approval gate / intake questions) continues server-side.
 * The client opens THIS stream after the human decision (or after a reload)
 * and receives:
 *
 * 1. a FULL ordered REPLAY of the run's frames (same seq space as phase 1 —
 *    the client's per-run store dedupes by seq, so nothing duplicates),
 * 2. the live remainder (apply → verify → validate → critic → answer),
 * 3. the `result` frame + RUN_COMPLETED terminal.
 *
 * When the in-memory ledger is gone (server restart), the run state is
 * re-read from the DB and an honest minimal replay is synthesized — the
 * chain shows what actually happened, never a fabricated full timeline.
 */

const bodySchema = z.object({
  runId: z.string().min(8).max(120),
  /** Last seq the client already processed (0 = full replay). */
  fromSeq: z.number().int().min(0).max(1_000_000).optional(),
});

export const dynamic = "force-dynamic";

const RESUME_MAX_LIFETIME_MS = 30 * 60_000;
const HEARTBEAT_MS = 15_000;

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ ok: false, error: "Invalid request payload." }, { status: 400 });
  }

  const { runId } = parsed.data;
  const fromSeq = parsed.data.fromSeq ?? 0;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let unsubscribe: (() => void) | null = null;
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
      let lifetimeTimer: ReturnType<typeof setTimeout> | null = null;
      /** Frames with seq ≤ this are REPLAY (already processed by the client
       *  on a previous stream). Declared before `deliver` — the replay may
       *  invoke it synchronously during subscribe. */
      const lastSeqAtOpen = getRunStreamLastSeq(runId);

      const finish = (logMessage: string): void => {
        if (closed) return;
        closed = true;
        unsubscribe?.();
        unsubscribe = null;
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (lifetimeTimer) clearTimeout(lifetimeTimer);
        try {
          controller.close();
        } catch {
          // already closed
        }
        logInfo(logMessage, { runId });
      };

      const writeFrame = (eventName: string, data: unknown): void => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          finish("assistant resume: client went away");
        }
      };

      const deliver = (frame: {
        kind: string;
        event?: { type: string; seq: number };
        frame?: Record<string, unknown>;
        message?: string;
      }): void => {
        if (frame.kind === "event" && frame.event) {
          writeFrame(frame.event.type, frame.event);
          if (
            frame.event.type === "RUN_COMPLETED" ||
            frame.event.type === "RUN_FAILED" ||
            frame.event.type === "RUN_CANCELLED"
          ) {
            // Terminal: the transport error frame (if any) was already
            // delivered before this point in ledger order; end the stream.
            setTimeout(() => finish("assistant resume: run terminal"), 60);
          } else if (
            frame.event.type === "RUN_PAUSED" &&
            frame.event.seq > lastSeqAtOpen
          ) {
            // A LIVE pause (a new gate reached during THIS stream — e.g. the
            // approval gate after the intake answers) — mirror the phase-1
            // contract exactly: the pause ends THIS response, the run keeps
            // waiting server-side, and the client re-resumes after the next
            // human decision (spec §5/§31/§110). Without this, the resume
            // stream hangs open and the client never settles into the
            // waiting state (the approval card never renders).
            setTimeout(() => finish("assistant resume: run paused"), 60);
          }
        } else if (frame.kind === "result" && frame.frame) {
          writeFrame("result", frame.frame);
        } else if (frame.kind === "error") {
          writeFrame("error", { error: frame.message ?? "The assistant run failed." });
        }
      };

      heartbeatTimer = setInterval(() => {
        if (closed) return;
        writeFrame("STREAM_HEARTBEAT", { type: "STREAM_HEARTBEAT", at: Date.now() });
      }, HEARTBEAT_MS);
      lifetimeTimer = setTimeout(() => {
        finish("assistant resume: lifetime cap reached");
      }, RESUME_MAX_LIFETIME_MS);

      // Client disconnect: detach ONLY — the run continues (the user may
      // reopen the conversation and resume again; spec §110).
      req.signal.addEventListener(
        "abort",
        () => finish("assistant resume: client disconnect"),
        { once: true },
      );

      if (!hasRunStream(runId)) {
        // Ledger gone (server restart / GC). Synthesize an honest minimal
        // replay from the DB — never fabricate the full timeline.
        void synthesizeReplay(runId).then((frames) => {
          if (frames === null) {
            const message =
              "The run's live stream is no longer available (the server restarted). The approval decision was recorded; check the Orchestrator console for the final state.";
            writeFrame("RUN_FAILED", {
              type: "RUN_FAILED",
              runId,
              seq: getRunStreamLastSeq(runId) + 1,
              error: message,
              failedAt: Date.now(),
            });
            writeFrame("error", { error: message });
            finish("assistant resume: no ledger — honest failure");
            return;
          }
          for (const frame of frames) deliver(frame);
          setTimeout(() => finish("assistant resume: synthesized replay delivered"), 60);
        });
        return;
      }

      const sub = subscribeRunFrames(runId, fromSeq, deliver);
      unsubscribe = sub.unsubscribe;
      logInfo("assistant resume stream opened", {
        runId,
        fromSeq,
        lastSeq: lastSeqAtOpen,
        paused: getRunPause(runId)?.reason ?? null,
        orchestratorRunId: getOrchestratorMapping(runId),
      });
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
    },
  });
}

/** Honest minimal replay from the DB when the in-memory ledger is gone. */
async function synthesizeReplay(
  assistantRunId: string,
): Promise<
  | { kind: "event"; event: { type: string; seq: number; runId: string; [k: string]: unknown } }[]
  | null
> {
  try {
    const orchestratorRunId = getOrchestratorMapping(assistantRunId);
    if (!orchestratorRunId) return null;
    const state = await getRunState(orchestratorRunId);
    if (!state) return null;
    const frames: { type: string; seq: number; runId: string; [k: string]: unknown }[] = [];
    let seq = 0;
    const push = (event: Record<string, unknown>): void => {
      seq += 1;
      frames.push({ type: String(event.type), seq, runId: assistantRunId, ...event } as never);
    };
    push({ type: "RUN_STARTED", startedAt: Date.now(), mode: "agent" });
    if (state.status === "failed") {
      push({ type: "RUN_FAILED", error: state.error ?? "The run failed.", failedAt: Date.now() });
    } else if (state.status === "cancelled") {
      push({ type: "RUN_CANCELLED", cancelledAt: Date.now() });
    } else {
      const approval = state.approvals.find((a) => a.status === "approved");
      if (approval) {
        push({ type: "APPROVAL_DECIDED", approvalId: approval.id, decision: "approved" });
      }
      if (state.status === "completed" && state.answer) {
        push({
          type: "RESPONSE_CHUNK",
          segment: { kind: "markdown", text: state.answer },
        });
        push({ type: "RUN_COMPLETED", completedAt: Date.now() });
      } else {
        push({
          type: "RUN_FAILED",
          error:
            "The run is still executing after a server restart — its live activity could not be recovered. Check the Orchestrator console.",
          failedAt: Date.now(),
        });
      }
    }
    return frames.map((event) => ({ kind: "event", event }));
  } catch (error) {
    logWarn("assistant resume: synthesis failed", {
      runId: assistantRunId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
