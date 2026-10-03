import { withApi } from "@/server/api/with-api";
import { jsonOk } from "@/server/api/envelope";
import { peekIndexStats } from "@/server/search/index/search-index";
import { CAPABILITY_LABELS } from "@/server/search/capability-labels";

/**
 * GET /api/search/index — honest index statistics + retrieval capability
 * labels (Phase 7 spec §3/§4 + V2.1 §D honesty).
 *
 * The workspace index builds lazily on the first search; before that this
 * reports built:false — never fabricated counts.
 */
export const GET = withApi(async (_req, ctx) => {
  const stats = peekIndexStats();
  return jsonOk(
    {
      ok: true,
      built: stats !== null,
      stats,
      capabilities: CAPABILITY_LABELS,
    },
    { requestId: ctx.requestId },
  );
});
