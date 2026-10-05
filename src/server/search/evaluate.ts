/**
 * CodeMind X V2 — Phase 7 search evaluation hooks (spec §11).
 *
 * Measures Precision@K, Recall@K, MRR and NDCG over a REAL judgments
 * dataset against the live hybrid search — plus per-query latency. Metrics
 * are computed, never displayed when they do not exist: with no dataset the
 * API answers exactly `Evaluation not run.`.
 *
 * The bundled dataset (`BUILTIN_JUDGMENTS`) contains real, verifiable
 * judgments against THIS workspace's actual files — the grader inputs are
 * labeled, the metrics are outputs of running the engine.
 */

import type { SearchIndex } from "./index/search-index";
import { runHybridSearch, type SearchMode } from "./search-service";

export interface JudgmentEntry {
  query: string;
  mode?: SearchMode;
  /** path → graded relevance (2 highly relevant, 1 relevant, 0 noise). */
  relevant: Record<string, number>;
}

export interface QueryEvaluation {
  query: string;
  precisionAt5: number;
  recallAt5: number;
  reciprocalRank: number;
  ndcgAt10: number;
  latencyMs: number;
  hits: number;
}

export interface EvaluationResult {
  status: "ok";
  kind: "search-quality";
  dataset: string;
  queries: QueryEvaluation[];
  aggregate: {
    precisionAt5: number;
    recallAt5: number;
    mrr: number;
    ndcgAt10: number;
    meanLatencyMs: number;
  };
  ranAt: string;
}

export const NOT_RUN_MESSAGE = "Evaluation not run.";

/**
 * Built-in judgments: real files of this workspace, graded by path
 * semantics (verified against the actual repository layout).
 */
export const BUILTIN_JUDGMENTS: JudgmentEntry[] = [
  {
    query: "monaco editor component",
    relevant: {
      "src/features/workspace/editor/MonacoCodeEditor.tsx": 2,
      "src/features/workspace/editor/monaco-setup.ts": 1,
      "src/features/workspace/repository/CodeEditorViewport.tsx": 1,
    },
  },
  {
    query: "editor navigation service",
    relevant: {
      "src/features/workspace/editor-navigation.ts": 2,
      "src/features/workspace/repository/RepositoryWorkspaceShell.tsx": 1,
    },
  },
  {
    query: "hybrid search retrieval",
    relevant: {
      "src/server/search/search-service.ts": 2,
      "src/server/search/index/search-index.ts": 1,
      "src/server/search/index/bm25.ts": 1,
    },
  },
  {
    query: "repository file tree endpoint",
    relevant: {
      "src/lib/server/repository-fs.ts": 2,
      "src/app/api/repository/tree/route.ts": 2,
    },
  },
  {
    query: "prisma database schema models",
    relevant: {
      "prisma/schema.prisma": 2,
      "src/lib/db.ts": 1,
    },
  },
  {
    query: "login ka pura flow dikhao",
    relevant: {
      "src/server/security/auth.ts": 1,
      "src/app/api/auth/route.ts": 1,
      "src/features/workspace/editor-navigation.ts": 0,
    },
  },
];

/**
 * The GOLDEN DATASET (V2.1 §C) — formalized now so measurable evaluation
 * never waits for a later phase. v1 ships with the judgments above; Phase
 * 7.5 adds the first benchmark expansion cases on this exact structure.
 */
export const GOLDEN_DATASET = {
  id: "codemind-golden-search-v1",
  version: 1 as const,
  description:
    "Golden search-quality dataset: real, verifiable relevance judgments against this workspace's actual files.",
  cases: BUILTIN_JUDGMENTS,
  /** Phase 7.5 owns the first benchmark-case additions; nothing is pre-claimed. */
  nextExpansion: "phase-7.5",
} as const;

function dcg(gains: number[]): number {
  return gains.reduce((sum, gain, index) => sum + (Math.pow(2, gain) - 1) / Math.log2(index + 2), 0);
}

/** Evaluate the hybrid engine over a judgments dataset (real run). */
export async function evaluateSearch(
  index: SearchIndex,
  dataset: JudgmentEntry[],
): Promise<EvaluationResult> {
  const queryEvaluations: QueryEvaluation[] = [];

  for (const entry of dataset) {
    const started = performance.now();
    const response = await runHybridSearch(index, {
      query: entry.query,
      mode: entry.mode ?? "auto",
      limit: 10,
    });
    const latencyMs = performance.now() - started;

    const graded = response.results.map((hit) => entry.relevant[hit.file] ?? 0);
    const top5 = graded.slice(0, 5);
    const relevantCount = Object.values(entry.relevant).filter((g) => g > 0).length;

    const precisionAt5 = top5.filter((g) => g > 0).length / Math.max(1, top5.length);
    const recallAt5 = relevantCount === 0 ? 0 : top5.filter((g) => g > 0).length / relevantCount;

    let reciprocalRank = 0;
    for (let i = 0; i < graded.length; i += 1) {
      if (graded[i]! > 0) {
        reciprocalRank = 1 / (i + 1);
        break;
      }
    }

    const ndcgAt10 =
      dcg(graded.slice(0, 10)) /
      dcg(
        Object.values(entry.relevant)
          .sort((a, b) => b - a)
          .slice(0, 10),
      ) || 0;

    queryEvaluations.push({
      query: entry.query,
      precisionAt5: round4(precisionAt5),
      recallAt5: round4(recallAt5),
      reciprocalRank: round4(reciprocalRank),
      ndcgAt10: round4(Math.max(0, ndcgAt10)),
      latencyMs: round4(latencyMs),
      hits: response.results.length,
    });
  }

  const n = Math.max(1, queryEvaluations.length);
  const aggregate = {
    precisionAt5: round4(queryEvaluations.reduce((s, q) => s + q.precisionAt5, 0) / n),
    recallAt5: round4(queryEvaluations.reduce((s, q) => s + q.recallAt5, 0) / n),
    mrr: round4(queryEvaluations.reduce((s, q) => s + q.reciprocalRank, 0) / n),
    ndcgAt10: round4(queryEvaluations.reduce((s, q) => s + q.ndcgAt10, 0) / n),
    meanLatencyMs: round4(queryEvaluations.reduce((s, q) => s + q.latencyMs, 0) / n),
  };

  return {
    status: "ok",
    kind: "search-quality",
    dataset: GOLDEN_DATASET.id,
    queries: queryEvaluations,
    aggregate,
    ranAt: new Date().toISOString(),
  };
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
