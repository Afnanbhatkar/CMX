"use client";

/**
 * CodeMind X V2 — useRunActivity(runId) (Phase 8D, spec STEP C).
 *
 * Per-run external store binding: ONLY components subscribed to a run
 * re-render when that run's activity changes — a new event in one run never
 * re-renders the chat history or any other run (spec "PER-RUN STORE").
 * useSyncExternalStore keeps reads tear-free; the server snapshot is one
 * stable shared object so SSR/strict re-render stays safe.
 */

import { useCallback, useSyncExternalStore } from "react";

import type { RunActivitySnapshot } from "@/types/contracts";
import {
  getRunActivitySnapshot,
  getServerRunActivitySnapshot,
  subscribeRunActivity,
} from "./run-activity-store";

export function useRunActivity(runId: string | null): RunActivitySnapshot {
  const subscribe = useCallback(
    (listener: () => void) =>
      runId ? subscribeRunActivity(runId, listener) : () => undefined,
    [runId],
  );
  const getSnapshot = useCallback(
    () => (runId ? getRunActivitySnapshot(runId) : getServerRunActivitySnapshot()),
    [runId],
  );

  return useSyncExternalStore(subscribe, getSnapshot, getServerRunActivitySnapshot);
}
