"use client";

/**
 * CodeMind X V2 — assistant engine verification exposure (Phase 8 plumbing).
 *
 * Exposes read-only observation of the ActivityEngine on window.__cmxAssistant
 * for browser-driven verification (same precedent as window.__cmxPerf).
 * Nothing here mutates app state; the engine stays the single writer.
 */

import { assistantActivityEngine } from "./activity-engine";
import { ASSISTANT_CONTRACT_VERSION } from "./contracts";

declare global {
  interface Window {
    __cmxAssistant?: {
      contractVersion: string;
      engineState: () => ReturnType<typeof assistantActivityEngine.getSnapshot>;
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
  };
}
