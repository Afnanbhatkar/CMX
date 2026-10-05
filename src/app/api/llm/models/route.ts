import { NextResponse } from "next/server";

import { withApi } from "@/server/api/with-api";
import { GATEWAY_PROVIDER, LLMGateway } from "@/server/llm/llm-gateway";

/**
 * GET /api/llm/models — the LLM Gateway's REAL model catalog (Phase 8A §6).
 *
 * The composer's model picker renders exactly this list. It is measured
 * truth, not marketing: today the transport serves one effective chat model
 * (`glm-4-plus`) for all chat requests, and the catalog says so. No provider
 * name or SDK detail is hardcoded into UI code — the UI reads this endpoint.
 */
export const GET = withApi(async (_req, ctx) => {
  return NextResponse.json(
    {
      ok: true,
      provider: GATEWAY_PROVIDER,
      models: LLMGateway.listModels(),
    },
    { headers: { "x-request-id": ctx.requestId } },
  );
});
