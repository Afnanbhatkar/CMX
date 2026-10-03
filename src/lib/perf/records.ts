/**
 * CodeMind X V2 — performance sample storage (V2.1 ADDITIONS §E).
 *
 * SERVER-SAFE: no "use client" — both the browser HUD and the API routes
 * import this module, so search latency is measured on the server too.
 *
 * MEASURE, do not merely claim:
 * - editor keystroke interaction target ≈ 16 ms (keydown → content change);
 * - large-file open (5 MB benchmark through the real large-file path);
 * - worker parse duration;
 * - search query duration (Phase 7).
 *
 * Samples are collected in-ring (last 200 per metric) and summarized as
 * p50/p95/max/last. The PerfHUD renders the REAL numbers; nothing is
 * simulated or pre-filled. Budget status = measured value vs budget.
 */

export type PerfMetric =
  | "editor.keystroke"
  | "editor.large-file-open"
  | "editor.model-create"
  | "worker.parse"
  | "search.query";

/** Honest budgets (ms). */
export const PERF_BUDGETS: Record<PerfMetric, number> = {
  "editor.keystroke": 16,
  "editor.large-file-open": 1_000,
  "editor.model-create": 150,
  "worker.parse": 500,
  "search.query": 800,
};

export const PERF_BUDGET_NOTES: Record<PerfMetric, string> = {
  "editor.keystroke":
    "Keydown → model content change, measured in the live editor. Budget ≈ one 60 fps frame (16 ms).",
  "editor.large-file-open":
    "End-to-end large-file path: model acquire + editor attach + first rendered frame (5 MB benchmark).",
  "editor.model-create":
    "Monaco model creation/reuse through the model manager.",
  "worker.parse": "Code structure parse running in the web worker (main thread stays free).",
  "search.query": "Server-side hybrid search round-trip (normalize → retrieve → fuse).",
};

const RING_SIZE = 200;

interface MetricStore {
  samples: number[];
  /** Extra structured details for the last large-file run (honest numbers). */
  lastDetail: Record<string, number> | null;
}

const store = new Map<PerfMetric, MetricStore>();

function metricStore(metric: PerfMetric): MetricStore {
  let entry = store.get(metric);
  if (!entry) {
    entry = { samples: [], lastDetail: null };
    store.set(metric, entry);
  }
  return entry;
}

export function recordPerfSample(metric: PerfMetric, ms: number): void {
  if (!Number.isFinite(ms) || ms < 0) return;
  const entry = metricStore(metric);
  entry.samples.push(Math.round(ms * 100) / 100);
  if (entry.samples.length > RING_SIZE) entry.samples.shift();
}

export function recordPerfDetail(metric: PerfMetric, detail: Record<string, number>): void {
  metricStore(metric).lastDetail = detail;
}

export interface PerfStats {
  count: number;
  p50: number | null;
  p95: number | null;
  max: number | null;
  last: number | null;
  budget: number;
  /** true when the LAST sample is within budget. */
  withinBudget: boolean | null;
  lastDetail: Record<string, number> | null;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? null;
}

export function getPerfStats(metric: PerfMetric): PerfStats {
  const entry = metricStore(metric);
  const sorted = [...entry.samples].sort((a, b) => a - b);
  const last = entry.samples.length > 0 ? entry.samples[entry.samples.length - 1]! : null;
  return {
    count: entry.samples.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted.length > 0 ? sorted[sorted.length - 1]! : null,
    last,
    budget: PERF_BUDGETS[metric],
    withinBudget: last === null ? null : last <= PERF_BUDGETS[metric],
    lastDetail: entry.lastDetail,
  };
}

/** All metrics with samples (HUD renders exactly what was measured). */
export function getMeasuredMetrics(): PerfMetric[] {
  return (Object.keys(PERF_BUDGETS) as PerfMetric[]).filter(
    (metric) => metricStore(metric).samples.length > 0,
  );
}
