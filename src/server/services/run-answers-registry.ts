import { AssistantError } from "./assistant-service";

/**
 * CodeMind X V2 — pending intake answers registry (Phase 8C).
 *
 * The 8C question flow pauses a run INSIDE its SSE stream: the run surface
 * awaits the user's answers through this module, and the dedicated answers
 * route (POST /api/assistant/runs/answers) resolves the waiting run. One
 * entry per paused run; memory-resident by design — if the server restarts
 * while a run is paused, the stream fails honestly (RUN_FAILED), never a
 * fake resume.
 */

interface PendingAnswers {
  resolve: (answers: IntakeAnswerWire[]) => void;
  reject: (error: AssistantError) => void;
  createdAt: number;
  /** Abort handling: client disconnect / stop must not leave a dangling run. */
  cancel: () => void;
}

/** Wire shape of one answer (mirrors the IntakeAnswer contract). */
export interface IntakeAnswerWire {
  questionId: string;
  optionId: string | null;
  customText: string | null;
}

/** How long a run may stay paused for answers before it is cancelled. */
const ANSWER_TIMEOUT_MS = 10 * 60 * 1_000;

/**
 * The pending map MUST live on globalThis: Next.js compiles each route with
 * its own module graph, so a module-level Map would be instantiated twice
 * (one per route) and the answers route would never see the runs route's
 * pending entries. globalThis is shared across the whole server process.
 */
interface PendingAnswersGlobal {
  __cmxPendingIntakeAnswers?: Map<string, PendingAnswers>;
}
const globalStore = globalThis as unknown as PendingAnswersGlobal;
const pending: Map<string, PendingAnswers> =
  globalStore.__cmxPendingIntakeAnswers ?? new Map<string, PendingAnswers>();
globalStore.__cmxPendingIntakeAnswers = pending;

export function waitForAnswers(
  runId: string,
  onCancel: () => void,
): Promise<IntakeAnswerWire[]> {
  return new Promise<IntakeAnswerWire[]>((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (pending.has(runId)) {
        pending.delete(runId);
        reject(
          new AssistantError(
            "cancelled",
            "No answer arrived within 10 minutes — the paused run was cancelled.",
          ),
        );
      }
    }, ANSWER_TIMEOUT_MS);

    const cancel = (): void => {
      clearTimeout(timeout);
      if (pending.has(runId)) {
        pending.delete(runId);
        reject(new AssistantError("cancelled", "The run was cancelled while waiting for your answers."));
      }
      onCancel();
    };

    pending.set(runId, {
      resolve: (answers) => {
        clearTimeout(timeout);
        pending.delete(runId);
        resolve(answers);
      },
      reject: (error) => {
        clearTimeout(timeout);
        pending.delete(runId);
        reject(error);
      },
      createdAt: Date.now(),
      cancel,
    });
  });
}

/** Resolve a paused run with the user's answers. Returns false when no run is waiting. */
export function provideAnswers(runId: string, answers: IntakeAnswerWire[]): boolean {
  const entry = pending.get(runId);
  if (!entry) return false;
  entry.resolve(answers);
  return true;
}

/** Cancel a paused run (client disconnect / explicit stop). */
export function cancelPendingRun(runId: string): void {
  pending.get(runId)?.cancel();
}

export function hasPendingAnswers(runId: string): boolean {
  return pending.has(runId);
}
