"use client";

/**
 * CodeMind X V2 — perf tooling exposure (V2.1 ADDITIONS §E).
 *
 * Exposes the measurement harness on window.__cmxPerf for verification
 * tooling (browser-driven checks). Read-only observation plus the explicit
 * 5 MB large-file benchmark; nothing here mutates app state.
 */

import {
  getPerfStats,
  type PerfMetric,
  type PerfStats,
} from "./records";
import {
  runLargeFileBenchmark,
  type LargeFileBenchmarkResult,
} from "./budgets";

declare global {
  interface Window {
    __cmxPerf?: {
      stats: (metric: PerfMetric) => PerfStats;
      largeFileBenchmark: (bytes?: number) => Promise<LargeFileBenchmarkResult>;
    };
  }
}

let exposed = false;

export function exposePerfTooling(): void {
  if (exposed || typeof window === "undefined") return;
  exposed = true;
  window.__cmxPerf = {
    stats: getPerfStats,
    largeFileBenchmark: runLargeFileBenchmark,
  };
}
