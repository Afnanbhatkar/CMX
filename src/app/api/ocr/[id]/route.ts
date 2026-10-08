import { withApi } from "@/server/api/with-api";
import { ApiError, jsonOk } from "@/server/api/envelope";
import { deleteOcrJob, getOcrJob } from "@/server/services/ocr-service";

/**
 * CodeMind X V2 — OCR Studio single-job API.
 *
 * GET    /api/ocr/[id] — one job (history detail / re-open).
 * DELETE /api/ocr/[id] — removes the history row (204 on success).
 */

export const dynamic = "force-dynamic";

export const GET = withApi<{ params: Promise<{ id: string }> }>(
  async (_req, ctx) => {
    const { id } = await ctx.params;
    const job = await getOcrJob(id);
    if (!job) {
      throw new ApiError("NOT_FOUND", "No OCR job with that id.", 404);
    }
    return jsonOk(job, { requestId: ctx.requestId });
  },
);

export const DELETE = withApi<{ params: Promise<{ id: string }> }>(
  async (_req, ctx) => {
    const { id } = await ctx.params;
    const deleted = await deleteOcrJob(id);
    if (!deleted) {
      throw new ApiError("NOT_FOUND", "No OCR job with that id.", 404);
    }
    return new Response(null, { status: 204 });
  },
);
