import { z } from "zod";

import { withApi } from "@/server/api/with-api";
import { ApiError, jsonOk } from "@/server/api/envelope";
import { getSearchIndex } from "@/server/search/index/search-index";
import { evaluateSearch, NOT_RUN_MESSAGE, GOLDEN_DATASET, type EvaluationResult } from "@/server/search/evaluate";
import { db } from "@/lib/db";

/**
 * /api/search/evaluate — Phase 7 spec §11 + V2.1 §C golden dataset.
 *
 * GET  → the last persisted search evaluation, or exactly "Evaluation not
 *         run." when none exists. Never displays made-up metrics.
 * POST → RUNS the evaluation now over the golden dataset (the built-in
 *         workspace judgments), computes P@K / R@K / MRR / NDCG / latency
 *         from the live engine, persists an Evaluation row and returns the
 *         full measured result. Phase 7.5 adds benchmark cases to the same
 *         dataset structure — nothing is pre-claimed before a real run.
 */

const evaluateRequestSchema = z.object({
  // "builtin" is the legacy alias of the golden dataset v1 cases.
  dataset: z.enum(["builtin", "codemind-golden-search-v1"]).default("builtin"),
});

export const GET = withApi(async (_req, ctx) => {
  const rows = await db.evaluation.findMany({
    where: { kind: "search-quality" },
    orderBy: { createdAt: "desc" },
    take: 1,
  });
  const last = rows[0];
  if (!last) {
    return jsonOk(
      { ok: true, status: NOT_RUN_MESSAGE, evaluation: null },
      { requestId: ctx.requestId },
    );
  }
  let evaluation: EvaluationResult | null = null;
  try {
    evaluation = JSON.parse(last.summary ?? "null") as EvaluationResult | null;
  } catch {
    evaluation = null;
  }
  return jsonOk(
    {
      ok: true,
      status: evaluation ? "ok" : NOT_RUN_MESSAGE,
      ranAt: last.createdAt,
      aggregate: evaluation?.aggregate ?? null,
      evaluation,
    },
    { requestId: ctx.requestId },
  );
});

export const POST = withApi(
  async (req, ctx) => {
    let body: unknown = {};
    try {
      const text = await req.text();
      if (text) body = JSON.parse(text);
    } catch {
      throw new ApiError("BAD_REQUEST", "Invalid JSON body.", 400);
    }
    const parsed = evaluateRequestSchema.parse(body);

    if (parsed.dataset !== "builtin" && parsed.dataset !== GOLDEN_DATASET.id) {
      throw new ApiError("BAD_REQUEST", "Unknown dataset.", 400);
    }

    const { index } = await getSearchIndex();
    const evaluation = await evaluateSearch(index, GOLDEN_DATASET.cases);

    try {
      await db.evaluation.create({
        data: {
          kind: "search-quality",
          score: evaluation.aggregate.ndcgAt10,
          summary: JSON.stringify(evaluation).slice(0, 20_000),
        },
      });
    } catch {
      // persistence is best-effort; the measured result is still returned
    }

    return jsonOk(
      { ok: true, dataset: GOLDEN_DATASET.id, evaluation },
      { requestId: ctx.requestId },
    );
  },
  { allowBody: true },
);
