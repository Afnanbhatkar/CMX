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
import type { SequencedAssistantEvent } from "./contracts";
import {
  exportPersistedChain,
  getRunActivityDebug,
  getRunActivitySnapshot,
  ingestLocalRunActivityEvent,
  ingestRunActivityEvent,
  resumeRunActivity,
  type LocalRunActivityEvent,
} from "@/features/workspace/chat/activity/run-activity-store";

declare global {
  interface Window {
    __cmxAssistant?: {
      contractVersion: string;
      engineState: () => ReturnType<typeof assistantActivityEngine.getSnapshot>;
      /** Measured metrics of the last wire-driven run (null before one). */
      lastRunMetrics: () => ReturnType<typeof getLastRunMetrics>;
      /** The pipeline stage vocabulary (memory-aware pipeline, V2.1). */
      pipelineStages: readonly string[];
      /** 8C: the last run's measured context snapshot (null before one). */
      lastContextSnapshot: () => ReturnType<
        typeof assistantActivityEngine.getSnapshot
      >["contextSnapshot"];
    };
    /**
     * 8D verification harness for the per-run activity chain. `ingest`
     * exists ONLY for browser-driven verification of the phase machine
     * (solving transitions, dedup, waiting) with synthetic events; the
     * production UI ingests real wire events exclusively.
     */
    __cmxRunActivity?: {
      ingest: (event: SequencedAssistantEvent) => void;
      ingestLocal: (event: LocalRunActivityEvent) => void;
      resume: (runId: string) => void;
      snapshot: (runId: string) => ReturnType<typeof getRunActivitySnapshot>;
      chain: (runId: string) => ReturnType<typeof exportPersistedChain>;
      debug: () => ReturnType<typeof getRunActivityDebug>;
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
    lastContextSnapshot: () => assistantActivityEngine.getSnapshot().contextSnapshot,
  };
  window.__cmxRunActivity = {
    ingest: ingestRunActivityEvent,
    ingestLocal: ingestLocalRunActivityEvent,
    resume: resumeRunActivity,
    snapshot: getRunActivitySnapshot,
    chain: exportPersistedChain,
    debug: getRunActivityDebug,
  };
}
