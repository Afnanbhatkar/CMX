import { z } from "zod";

import { withApi } from "@/server/api/with-api";
import { ApiError, jsonOk } from "@/server/api/envelope";
import { searchQuerySchema } from "@/server/schemas/api";
import { buildWorkspaceTree } from "@/lib/server/repository-fs";
import { searchFileNames } from "@/server/services/file-service";
import { db } from "@/lib/db";
import { getSearchIndex } from "@/server/search/index/search-index";
import { runHybridSearch, type SearchMode } from "@/server/search/search-service";
import { recordPerfSample } from "@/lib/perf/records";

/**
 * /api/search — Phase 7 hybrid code search.
 *
 * GET  ?q=&limit= — legacy honest filename search over the workspace tree
 * (Phase 3 contract preserved byte-for-byte in behavior).
 *
 * POST — the hybrid engine: lexical BM25 + dense hashed n-gram vectors +
 * symbol + path + import-graph + git context, RRF-fused and MMR-diversified,
 * Hindi/Hinglish-aware with contextual (current file/symbol) resolution.
 * Every search persists a REAL Activity row (kind "search") — a safe
 * execution summary, never model reasoning.
 */

const searchRequestSchema = z.object({
  query: z.string().min(1).max(300),
  mode: z
    .enum([
      "auto",
      "natural-language",
      "semantic",
      "keyword",
      "exact",
      "symbol",
      "filename",
      "regex",
      "api",
      "dependency",
      "git",
      "security",
      "documentation",
    ])
    .default("auto"),
  filters: z
    .object({
      language: z.string().max(40).nullish(),
      pathPrefix: z.string().max(200).nullish(),
      scope: z.enum(["all", "code", "tests", "docs", "config"]).nullish(),
    })
    .optional(),
  context: z
    .object({
      currentFile: z.string().max(300).nullish(),
      currentSymbol: z.string().max(120).nullish(),
      recentQueries: z.array(z.string().max(300)).max(10).optional(),
    })
    .optional(),
  limit: z.number().int().min(1).max(50).default(20),
});

export const GET = withApi(async (req, ctx) => {
  const url = new URL(req.url);
  const { q, limit } = searchQuerySchema.parse(Object.fromEntries(url.searchParams));

  const tree = await buildWorkspaceTree();
  const matches = searchFileNames(tree, q, limit);

  return jsonOk(
    {
      query: q,
      matches,
      scope: "filenames",
      note: "legacy filename search — use POST /api/search for hybrid retrieval",
    },
    { requestId: ctx.requestId },
  );
});

export const POST = withApi(
  async (req, ctx) => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new ApiError("BAD_REQUEST", "Invalid JSON body.", 400);
    }
    const parsed = searchRequestSchema.parse(body);

    const { index, rebuilt } = await getSearchIndex();
    const response = await runHybridSearch(index, {
      query: parsed.query,
      mode: parsed.mode as SearchMode,
      filters: parsed.filters ?? {},
      context: {
        currentFile: parsed.context?.currentFile ?? null,
        currentSymbol: parsed.context?.currentSymbol ?? null,
        recentQueries: parsed.context?.recentQueries,
      },
      limit: parsed.limit,
    });
    response.index.rebuilt = rebuilt;

    // Perf budget measurement (V2.1 §E — search.query is a real budget).
    recordPerfSample("search.query", response.timings.totalMs);

    // Persist the user-visible activity (safe summary only).
    try {
      await db.activity.create({
        data: {
          kind: "search",
          label: response.activity.label.slice(0, 120),
          status: "done",
          endedAt: new Date(),
        },
      });
    } catch {
      // Activity persistence is best-effort; search results stay real.
    }

    return jsonOk(response, { requestId: ctx.requestId });
  },
  { allowBody: true },
);
