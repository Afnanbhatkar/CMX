"use client";

/**
 * CodeMind X V2 — assistant engine verification exposure (Phase 8 plumbing,
 * extended in 8B).
 *
 * Exposes read-only observation of the ActivityEngine + the last run's
 * measured metrics on window.__cmxAssistant for browser-driven verification
 * (same precedent as window.__cmxPerf). Nothing here mutates app state; the
 * engine stays the single writer.
 */

import { assistantActivityEngine } from "./activity-engine";
import { ASSISTANT_CONTRACT_VERSION, PIPELINE_STAGES } from "./contracts";
import { getLastRunMetrics } from "./run-adapter";

declare global {
  interface Window {
    __cmxAssistant?: {
      contractVersion: string;
      engineState: () => ReturnType<typeof assistantActivityEngine.getSnapshot>;
      /** Measured metrics of the last wire-driven run (null before one). */
      lastRunMetrics: () => ReturnType<typeof getLastRunMetrics>;
      /** The pipeline stage vocabulary (memory-aware pipeline, V2.1). */
      pipelineStages: readonly string[];
    };
  }
}

let exposed = false;

export function exposeAssistantTooling(): void {
  if (exposed || typeof window === "undefined") return;
  exposed = true;
  window.__cmxAssistant = {
    contractVersion: ASSISTANT_CONTRACT_VERSION,
    engineState: () => assistantActivityEngine.getSnapshot(),
    lastRunMetrics: () => getLastRunMetrics(),
    pipelineStages: PIPELINE_STAGES,
  };
}
