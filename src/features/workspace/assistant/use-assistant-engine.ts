"use client";

/**
 * React binding for the ActivityEngine snapshot (Phase 8 plumbing).
 * Sub-phases (8B) render from this hook — the engine itself stays
 * framework-agnostic.
 */

import { useSyncExternalStore } from "react";

import { assistantActivityEngine, type ActivityEngineSnapshot } from "./activity-engine";

export function useAssistantEngineSnapshot(): ActivityEngineSnapshot {
  return useSyncExternalStore(
    assistantActivityEngine.subscribe,
    assistantActivityEngine.getSnapshot,
    assistantActivityEngine.getSnapshot,
  );
}

export type { ActivityEngineSnapshot };
